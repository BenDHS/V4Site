// Three.js GLTF Viewer (Camera Cycling Mode)
// Locks viewport to exported glTF cameras; mouse wheel cycles cameras.
// Added: Unified input controls
//  - Mouse wheel & trackpad (accumulated small deltas) cycle cameras
//  - Touch vertical swipe (single finger) cycles cameras
//  - On-screen buttons (▲/▼) for accessibility / mobile tapping
//  - Keyboard left/right arrows also cycle (existing) and preserved
// Implementation notes: we debounce rapid triggers using a cooldown and
// accumulate small wheel deltas typical of trackpads to provide a single
// camera change per intentional scroll gesture.

import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';

// If you exported e.g. scene.glb to public/models, set:
const MODEL_URL = './models/scene.glb'; // Change to your file name (.gltf or .glb)

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const progressEl = document.getElementById('progress');
const errorEl = document.getElementById('error');
const dropzoneEl = document.getElementById('dropzone');
const camInfoEl = document.getElementById('camInfo');

let renderer, scene, fallbackCamera, currentRoot;
let gltfCameras = []; // collected cameras from glTF
let activeCamIndex = -1;
let activeRenderCamera = null;
let __dashTex = null; let __dashMatRefs = [];
let __dashDebugMeshes = []; let __dashPatternMat = null; let __dashBBoxHelpers = []; let __dashWire = false;
let __dashOverlayPlane = null; let __dashDebugState = 0; // 0 normal,1 pattern,2 solid,3 overlay
let __dashPatternTex = null; let __dashSurrogatePlane = null;

// --- LIGHT HELPERS ---
let lightHelpers = [];
let lightLabels = [];
// -------------

init();
loadInitial();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  // Fallback camera used when no glTF cameras exist
  fallbackCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  fallbackCamera.position.set(2.5, 2, 3.5);
  activeRenderCamera = fallbackCamera;

  window.addEventListener('resize', onWindowResize);
  // Wheel (mouse & trackpad) handler (passive:false so we can prevent default)
  window.addEventListener('wheel', onWheel, { passive: false });
  // Touch swipe handlers for mobile
  setupTouch();
  // Optional on-screen buttons (if present in DOM)
  setupButtons();
  setupKeyboard();
}

function createMinimalHDRI() {
  const tempScene = new THREE.Scene();
  const light1 = new THREE.DirectionalLight(0xffffff, 1.5);
  light1.position.set(10, 10, 10);
  tempScene.add(light1);
  const light2 = new THREE.DirectionalLight(0xffffff, 0.5);
  light2.position.set(-10, -10, -10);
  tempScene.add(light2);
  return tempScene;
}

function loadInitial() {
  if (!MODEL_URL) return;
  loadModel(MODEL_URL).catch(e => showError(e));
}

function showError(e) {
  console.error(e);
  errorEl.style.display = 'block';
  errorEl.textContent = 'Error: ' + (e.message || e.toString());
}

function clearError() {
  errorEl.style.display = 'none';
  errorEl.textContent = '';
}

function setProgress(v) {
  if (Number.isFinite(v)) {
    progressEl.textContent = (v * 100).toFixed(0);
  } else {
    progressEl.textContent = '…';
  }
  if (v >= 1) loadingEl.classList.add('progress-done');
  else loadingEl.classList.remove('progress-done');
}

function loadModel(url, filesMap) {
  clearError();
  setProgress(0);
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    loader.setDRACOLoader(draco);

    if (filesMap) {
      loader.setCrossOrigin('anonymous');
      loader.setRequestHeader({});
      loader.setResourcePath('');
      loader.setPath('');
      loader.manager.setURLModifier((url) => {
        const file = filesMap.get(url.replace(/^\.\//, '')) || filesMap.get(url);
        if (file) {
          return URL.createObjectURL(file);
        }
        return url;
      });
    }

    loader.load(url, gltf => {
      if (currentRoot) {
        scene.remove(currentRoot);
        disposeHierarchy(currentRoot);
      }
      currentRoot = gltf.scene || gltf.scenes[0];
      scene.add(currentRoot);

      // --- LIVERY MATERIAL PATCH ---
      // Apply settings to mat_livery_0_157_001.004
      currentRoot.traverse(obj => {
        if (obj.isMesh && obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((mat, idx) => {
            if ((mat.name || '').trim() === 'mat_livery_0_157_001.004') {
              // Convert to MeshPhysicalMaterial if needed
              let physMat;
              if (mat.isMeshPhysicalMaterial) {
                physMat = mat;
              } else {
                physMat = new THREE.MeshPhysicalMaterial();
                // Copy existing properties
                if (mat.map) physMat.map = mat.map;
                if (mat.normalMap) physMat.normalMap = mat.normalMap;
                if (mat.roughnessMap) physMat.roughnessMap = mat.roughnessMap;
                if (mat.metalnessMap) physMat.metalnessMap = mat.metalnessMap;
                if (mat.emissiveMap) physMat.emissiveMap = mat.emissiveMap;
                if (mat.aoMap) physMat.aoMap = mat.aoMap;
                if (mat.color) physMat.color.copy(mat.color);
                if (mat.emissive) physMat.emissive.copy(mat.emissive);
                physMat.name = mat.name;
                
                // Replace the material
                if (Array.isArray(obj.material)) {
                  obj.material[idx] = physMat;
                } else {
                  obj.material = physMat;
                }
              }
              
              // Apply settings from mat.json
              physMat.color.setHex(16777215); // white
              physMat.roughness = 0;
              physMat.metalness = 0;
              physMat.sheen = 0;
              physMat.sheenColor.setHex(0);
              physMat.sheenRoughness = 1;
              physMat.emissive.setHex(0);
              physMat.specularIntensity = 0;
              physMat.specularColor.setHex(16777215);
              physMat.clearcoat = 0.7;
              physMat.clearcoatRoughness = 0;
              physMat.dispersion = 0;
              physMat.iridescence = 0;
              physMat.iridescenceIOR = 1.3;
              physMat.iridescenceThicknessRange = [100, 400];
              physMat.anisotropy = 0;
              physMat.anisotropyRotation = 0;
              physMat.envMapIntensity = 1;
              physMat.reflectivity = 0.49999999999999983;
              physMat.transmission = 0;
              physMat.thickness = 0;
              physMat.attenuationColor.setHex(16777215);
              
              physMat.needsUpdate = true;
              console.log('Applied livery material settings to:', mat.name);
            }
          });
        }
      });
      // --- END LIVERY MATERIAL PATCH ---

      // --- VIDEO TEXTURE PATCH ---
      // Create video element
      const video = document.createElement('video');
      video.src = './screen.mp4';
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.crossOrigin = 'anonymous';
      video.style.display = 'none';
      document.body.appendChild(video);
      video.play();
      // Create Three.js texture
      const videoTex = new THREE.VideoTexture(video);
      videoTex.colorSpace = THREE.SRGBColorSpace;
      videoTex.minFilter = THREE.LinearFilter;
      videoTex.magFilter = THREE.LinearFilter;
      videoTex.generateMipmaps = false;
      // Find mesh/material named 'SCREEN'
      currentRoot.traverse(obj => {
        if (obj.isMesh && obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((mat, idx) => {
            if ((mat.name || '').toUpperCase() === 'SCREEN') {
              // Use MeshStandardMaterial with both map and emissiveMap set to the video texture
              const stdMat = new THREE.MeshStandardMaterial({
                map: videoTex,
                emissiveMap: videoTex,
                color: 0xffffff,
                emissive: 0xffffff,
                emissiveIntensity: 0.3,
                toneMapped: true,
              });
              if (stdMat.map) {
                if ('colorSpace' in stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;
                if ('encoding' in stdMat.map) stdMat.map.encoding = THREE.sRGBEncoding;
              }
              if (stdMat.emissiveMap) {
                if ('colorSpace' in stdMat.emissiveMap) stdMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
                if ('encoding' in stdMat.emissiveMap) stdMat.emissiveMap.encoding = THREE.sRGBEncoding;
              }
              stdMat.needsUpdate = true;
              if (Array.isArray(obj.material)) {
                obj.material[idx] = stdMat;
              } else {
                obj.material = stdMat;
              }
            }
          });
        }
      });
      // --- END VIDEO PATCH ---

      // --- MATERIAL LIGHTING ENHANCEMENT ---
      currentRoot.traverse(obj => {
        if (obj.isMesh && obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((mat, idx) => {
            // Skip SCREEN materials (already handled above)
            if ((mat.name || '').toUpperCase() === 'SCREEN') return;
            // Ensure materials are physically based for proper lighting
            if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial) {
              const newMat = new THREE.MeshStandardMaterial();
              if (mat.map) newMat.map = mat.map;
              if (mat.normalMap) newMat.normalMap = mat.normalMap;
              if (mat.roughnessMap) newMat.roughnessMap = mat.roughnessMap;
              if (mat.metalnessMap) newMat.metalnessMap = mat.metalnessMap;
              if (mat.emissiveMap) newMat.emissiveMap = mat.emissiveMap;
              if (mat.aoMap) newMat.aoMap = mat.aoMap;
              if (mat.color) newMat.color.copy(mat.color);
              if (mat.emissive) newMat.emissive.copy(mat.emissive);
              newMat.metalness = mat.metalness !== undefined ? mat.metalness : 0.1;
              newMat.roughness = mat.roughness !== undefined ? mat.roughness : 0.7;
              newMat.name = mat.name;
              if (Array.isArray(obj.material)) {
                obj.material[idx] = newMat;
              } else {
                obj.material = newMat;
              }
            } else {
              if (mat.metalness === undefined) mat.metalness = 0.1;
              if (mat.roughness === undefined) mat.roughness = 0.7;
            }
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            mat.needsUpdate = true;
          });
        }
      });

      // --- END MATERIAL ENHANCEMENT ---
      // --- END MATERIAL ENHANCEMENT ---

  // --- DASHNEW INTERACTIVE MENU PATCH ---
      const dashDiv = document.getElementById('dash-ui');
      const dashCanvas = document.createElement('canvas');
      dashCanvas.width = 512; dashCanvas.height = 320;
      const dashCtx = dashCanvas.getContext('2d');
  const dashTex = new THREE.CanvasTexture(dashCanvas);
  dashTex.flipY = false; // Prevent Three.js from flipping the canvas (default true)
      __dashTex = dashTex;
  dashTex.colorSpace = THREE.SRGBColorSpace;
      dashTex.minFilter = THREE.LinearFilter;
      dashTex.magFilter = THREE.LinearFilter;
      dashTex.generateMipmaps = false;
      // Flip the canvas content vertically to match GL UVs
      function flipCanvasY(canvas) {
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const temp = ctx.createImageData(canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y++) {
          const src = y * canvas.width * 4;
          const dst = (canvas.height - y - 1) * canvas.width * 4;
          temp.data.set(imgData.data.subarray(src, src + canvas.width * 4), dst);
        }
        ctx.putImageData(temp, 0, 0);
      }
      // Helper to draw HTML to canvas
      function renderDashToCanvas() {
        dashCtx.clearRect(0,0,dashCanvas.width,dashCanvas.height);
        // Draw background
        dashCtx.fillStyle = '#181c24';
        dashCtx.fillRect(0,0,dashCanvas.width,dashCanvas.height);
        // Draw title
        dashCtx.font = 'bold 32px sans-serif';
        dashCtx.fillStyle = '#fff';
        dashCtx.textAlign = 'center';
        dashCtx.fillText('DASH MENU', dashCanvas.width/2, 60);
        // Draw buttons
        const btns = [
          {label:'Option 1', y:120, color:'#2a7cff'},
          {label:'Option 2', y:180, color:'#2a7cff'},
          {label:'Settings', y:240, color:'#444'}
        ];
        dashCtx.font = '20px sans-serif';
        btns.forEach((btn,i) => {
          dashCtx.fillStyle = btn.color;
          dashCtx.fillRect(dashCanvas.width/2-90, btn.y-24, 180, 40);
          dashCtx.fillStyle = '#fff';
          dashCtx.fillText(btn.label, dashCanvas.width/2, btn.y+4);
        });
        // Flip canvas vertically for correct UV orientation
        flipCanvasY(dashCanvas);
      }
      renderDashToCanvas();
      // Update texture on click (simulate interactivity)
      dashDiv.addEventListener('click', renderDashToCanvas);
      // Find mesh/material named 'DASHNEW' (backward compatible: also matches legacy 'DASH')
      let dashApplied = false;
      const dashCandidateMeshes = [];
      currentRoot.traverse(obj => {
        if (!obj.isMesh) return;
        const meshName = (obj.name || '').trim().toUpperCase();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((mat, idx) => {
          const rawName = (mat?.name || '').trim();
          const matName = rawName.toUpperCase();
          const isDash = mat && (matName === 'DASHNEW' || matName.includes('DASHNEW') || matName === 'DASH' || matName.includes('DASH') || meshName.includes('DASHNEW') || meshName.includes('DASH'));
          if (isDash) {
            // ...existing code...
            ensureDashMaterial(mat, dashTex);
            dashApplied = true;
            dashCandidateMeshes.push(obj);
          }
        });
      });
      if (!dashApplied) {
        console.warn('[DASH] DASHNEW/DASH material not found. Creating fallback UI material and assigning to first suitable mesh.');
        const targetMesh = findLargestMesh(currentRoot);
        if (targetMesh) {
          const basicMat = new THREE.MeshBasicMaterial({ map: dashTex });
          basicMat.name = 'DASHNEW_FALLBACK';
          targetMesh.material = basicMat;
          dashApplied = true;
          // ...existing code...
        } else {
    // ...existing code...
        }
      }
      function ensureDashMaterial(mat, tex) {
        if (!mat) return;
        __dashMatRefs.push(mat);
        // UV debug
  currentRoot.traverse(o=>{ if(o.isMesh && o.material===mat){ /* ...existing code... */ }});
        if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
          mat.map = tex;
          mat.emissive = new THREE.Color(0xffffff);
          mat.emissiveIntensity = 8.0;
          mat.emissiveMap = tex;
          mat.roughness = 0.1;
          mat.metalness = 0.0;
          mat.toneMapped = false;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        } else if (mat.isMeshBasicMaterial) {
          mat.map = tex;
          mat.side = THREE.DoubleSide;
          mat.needsUpdate = true;
        } else {
          const replacement = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
          replacement.name = mat.name || 'DASHNEW';
          // ...existing code...
          mat.dispose?.();
          currentRoot.traverse(o=>{ if(o.isMesh){ if (Array.isArray(o.material)) { o.material = o.material.map(m=> m===mat ? replacement : m); } else if (o.material === mat) { o.material = replacement; } }});
          __dashMatRefs.push(replacement);
        }
        tex.needsUpdate = true;
        // Capture meshes for further debug visuals
        currentRoot.traverse(o=>{ if(o.isMesh){ const materials = Array.isArray(o.material)?o.material:[o.material]; if(materials.includes(mat)) __dashDebugMeshes.push(o); }});
      }
      function findLargestMesh(root) {
        let best = null; let bestVol = 0;
        const box = new THREE.Box3();
        root.traverse(o=>{ if(o.isMesh){ box.setFromObject(o); const v = box.getSize(new THREE.Vector3()); const vol = v.x*v.y*v.z; if(vol>bestVol){ bestVol=vol; best=o; } }});
        return best;
      }
      // --- END DASH PATCH ---


      // Create pattern material AFTER collecting candidate meshes (once)
      if (!__dashPatternMat) {
        const pc = document.createElement('canvas'); pc.width = 256; pc.height = 256;
        const pctx = pc.getContext('2d');
        for (let y=0; y<16; y++) {
          for (let x=0; x<16; x++) {
            const on = (x+y)%2===0;
            pctx.fillStyle = on ? '#ff00ff' : '#00ffff';
            pctx.fillRect(x*16, y*16, 16,16);
          }
        }
        pctx.strokeStyle = '#000'; pctx.lineWidth = 4; pctx.strokeRect(2,2,252,252);
        const patternTex = new THREE.CanvasTexture(pc); patternTex.colorSpace = THREE.SRGBColorSpace; patternTex.minFilter = THREE.NearestFilter; patternTex.magFilter = THREE.NearestFilter; patternTex.generateMipmaps = false; patternTex.needsUpdate = true;
        __dashPatternTex = patternTex;
        __dashPatternMat = new THREE.MeshBasicMaterial({ map: patternTex, side: THREE.DoubleSide, toneMapped:false });
  // ...existing code...
      }

      // Overlay plane (mode 3) - build relative to first dash mesh
      if (!__dashOverlayPlane && __dashDebugMeshes.length) {
        const ref = __dashDebugMeshes[0];
        const box = new THREE.Box3().setFromObject(ref);
        const size = box.getSize(new THREE.Vector3());
        const planeW = size.x || 1; const planeH = size.y || size.z || 1;
        const planeGeo = new THREE.PlaneGeometry(planeW, planeH);
        const planeMat = new THREE.MeshBasicMaterial({ map: __dashTex, transparent:false, side:THREE.DoubleSide, toneMapped:false });
        const plane = new THREE.Mesh(planeGeo, planeMat);
        plane.name = 'DASH_OVERLAY_PLANE';
        // place plane at center, slightly forward along camera view vector relative to ref
        box.getCenter(plane.position);
        // attempt to align plane normal toward camera
        plane.lookAt(fallbackCamera.position);
        // offset slightly so it is not z-fighting
        const forward = new THREE.Vector3().subVectors(fallbackCamera.position, plane.position).normalize();
        plane.position.add(forward.multiplyScalar(0.01));
        scene.add(plane);
        __dashOverlayPlane = plane;
  // ...existing code...
      }

      // Log detailed diagnostics for each dash material
      // ...existing code...

      // Auto-fix UV orientation on load (same as pressing U key)
      if (__dashDebugMeshes.length > 0) {
        regenerateDashUVs();
      }

      // Collect cameras
      gltfCameras = [];
      if (gltf.cameras && gltf.cameras.length) gltf.cameras.forEach(c => gltfCameras.push(c));
      currentRoot.traverse(n => { if (n.isCamera && !gltfCameras.includes(n)) gltfCameras.push(n); });
      if (gltfCameras.length > 0) {
        activeCamIndex = 0;
        applyActiveCamera(true);
      } else {
        activeCamIndex = -1;
        activeRenderCamera = fallbackCamera;
        frameFallback(currentRoot);
        camInfoEl.style.display = 'none';
      }
      setProgress(1);
      resolve(gltf);
    }, xhrEvt => {
      if (xhrEvt.total) setProgress(xhrEvt.loaded / xhrEvt.total);
      else if (xhrEvt.loaded > 0) setProgress(undefined);
    }, err => {
      console.error('Failed to load model URL:', url, err);
      reject(err);
    });
  });
}

function disposeHierarchy(root) {
  root.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        for (const key in m) {
          const value = m[key];
            if (value && value.isTexture) value.dispose();
        }
        m.dispose?.();
      });
    }
  });
}

function frameFallback(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim * 1.8;
  fallbackCamera.position.copy(center.clone().add(new THREE.Vector3(dist, dist, dist)));
  fallbackCamera.lookAt(center);
}

function applyActiveCamera(instant=false) {
  const srcCam = gltfCameras[activeCamIndex];
  if (!srcCam) return;
  srcCam.updateWorldMatrix(true, true);
  if (srcCam.isPerspectiveCamera) {
    fallbackCamera.fov = srcCam.fov;
    fallbackCamera.near = srcCam.near;
    fallbackCamera.far = srcCam.far;
    fallbackCamera.updateProjectionMatrix();
  }
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  srcCam.matrixWorld.decompose(pos, quat, scale);
  if (instant) {
    fallbackCamera.position.copy(pos);
    fallbackCamera.quaternion.copy(quat);
  } else {
    // Cancel any prior tween by using a token
    applyActiveCamera._token = (applyActiveCamera._token || 0) + 1;
    const token = applyActiveCamera._token;
    const startPos = fallbackCamera.position.clone();
    const startQuat = fallbackCamera.quaternion.clone();
    const endPos = pos.clone();
    const endQuat = quat.clone();
    let t = 0; const duration = 1.0;
    function tween() {
      if (token !== applyActiveCamera._token) return; // superseded
      t += 1/60/duration; const k = t>=1?1:t;
      fallbackCamera.position.lerpVectors(startPos, endPos, k);
      fallbackCamera.quaternion.copy(startQuat).slerp(endQuat, k);
      if (k < 1) requestAnimationFrame(tween);
    }
    requestAnimationFrame(tween);
  }
  activeRenderCamera = fallbackCamera;
  updateCameraUI();
}

function updateCameraUI() {
  if (activeCamIndex < 0 || !gltfCameras.length) { camInfoEl.style.display='none'; return; }
  camInfoEl.style.display='block';
  const cam = gltfCameras[activeCamIndex];
  camInfoEl.textContent = `Cam: ${activeCamIndex+1}/${gltfCameras.length} ${cam.name || ''}`.trim();
}
// Central camera cycling utility
function cycleCamera(direction, animated=true) {
  if (!gltfCameras.length) return;
  activeCamIndex = (activeCamIndex + direction + gltfCameras.length) % gltfCameras.length;
  applyActiveCamera(!animated ? true : false); // we keep existing animation logic
}

// Mouse wheel only (disable trackpad accumulation to prevent conflicts)
let __wheelCooldownUntil = 0;
const WHEEL_COOLDOWN_MS = 500; // longer cooldown
function onWheel(e) {
  if (!gltfCameras.length) return;
  e.preventDefault();
  let dy = e.deltaY;
  // Normalize based on deltaMode (0=pixels,1=lines,2=pages)
  if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= window.innerHeight;
  const now = performance.now();
  
  // Only respond to significant wheel events (mouse wheel clicks)
  // Ignore small trackpad scrolling to prevent conflicts with touch
  if (Math.abs(dy) >= 25 && now >= __wheelCooldownUntil) {
    // Flip direction: up (dy < 0) increases camera index
    cycleCamera(dy < 0 ? 1 : -1);
    __wheelCooldownUntil = now + WHEEL_COOLDOWN_MS;
  }
}

// Touch swipe detection - single shot, no accumulation
let __touchGestureActive = false;
let __touchLastCameraChange = 0;
const TOUCH_SWIPE_THRESHOLD = 15; // much lower threshold for higher sensitivity
const TOUCH_GLOBAL_COOLDOWN = 1500; // 1.5 second global cooldown
function setupTouch() {
  let startY = null, startX = null, startTime = 0;
  
  window.addEventListener('touchstart', (e)=>{
    if (!gltfCameras.length || e.touches.length !== 1) return;
    if (__touchGestureActive) return; // one gesture at a time
    
    const t = e.touches[0];
    startY = t.clientY;
    startX = t.clientX; 
    startTime = performance.now();
  __touchGestureActive = true;
  }, { passive: true });
  
  window.addEventListener('touchend', (e)=>{
    if (!__touchGestureActive || startY === null) {
      __touchGestureActive = false;
      return;
    }
    
    const now = performance.now();
    if (now - __touchLastCameraChange < TOUCH_GLOBAL_COOLDOWN) {
      __touchGestureActive = false;
      startY = startX = null;
      return;
    }
    
    const changed = e.changedTouches[0];
    const dy = changed.clientY - startY;
    const dx = changed.clientX - startX;
    const ady = Math.abs(dy);
    const adx = Math.abs(dx);
    
    // Simple threshold check - mostly vertical movement
    if (ady >= TOUCH_SWIPE_THRESHOLD && ady > adx) {
      cycleCamera(dy > 0 ? 1 : -1);
      __touchLastCameraChange = now;
    }
    
    // Always reset gesture state
    __touchGestureActive = false;
    startY = startX = null;
  }, { passive: true });
  
  window.addEventListener('touchcancel', ()=>{
    __touchGestureActive = false;
    startY = startX = null;
  // ...existing code...
  }, { passive: true });
}

function setupButtons() {
  const nav = document.getElementById('camNav');
  if (!nav) return;
  const prevBtn = nav.querySelector('[data-cam-prev]');
  const nextBtn = nav.querySelector('[data-cam-next]');
  if (prevBtn) prevBtn.addEventListener('click', ()=> cycleCamera(-1));
  if (nextBtn) nextBtn.addEventListener('click', ()=> cycleCamera(1));
}


function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') {
      if (gltfCameras.length) applyActiveCamera(false); else if (currentRoot) frameFallback(currentRoot);
    }
    if (e.key === 'ArrowRight') { if (gltfCameras.length) { activeCamIndex = (activeCamIndex+1)%gltfCameras.length; applyActiveCamera(); } }
    if (e.key === 'ArrowLeft') { if (gltfCameras.length) { activeCamIndex = (activeCamIndex-1+gltfCameras.length)%gltfCameras.length; applyActiveCamera(); } }
    if (e.key.toLowerCase() === 'b') { __dashMatRefs.forEach(m => { if (!m) return; if (!m._origType) m._origType = m.type; }); }
    if (e.key.toLowerCase() === 'g') { window.__dashForcePattern = !window.__dashForcePattern; }
    if (e.key.toLowerCase() === 'x') { __dashDebugState = (__dashDebugState+1)%4; }
    if (e.key.toLowerCase() === 'h') { window.__dashShowBBox = !window.__dashShowBBox; }
    if (e.key.toLowerCase() === 'w') { window.__dashWire = !window.__dashWire; }
    if (e.key.toLowerCase() === 'p') { createSurrogateDashPlane(); }
    if (e.key.toLowerCase() === 'r') { repaintDashTest(); }
    if (e.key.toLowerCase() === 'u') { regenerateDashUVs(); }
    // REMOVED: OrbitControls and light helper toggles
  });
}
function replaceMaterialInstance(oldMat, newMat) {
  currentRoot.traverse(o=>{ if(o.isMesh){
    if (Array.isArray(o.material)) {
      o.material = o.material.map(m=> m===oldMat ? newMat : m);
    } else if (o.material === oldMat) {
      o.material = newMat;
    }
  }});
}

function onWindowResize() {
  fallbackCamera.aspect = window.innerWidth / window.innerHeight;
  fallbackCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (__dashTex) { __dashTex.needsUpdate = true; }
  if (__dashDebugMeshes.length && __dashPatternMat && (window.__dashForcePattern || __dashDebugState===1)) {
    __dashDebugMeshes.forEach(m=>{
      if(!m._origMats){ m._origMats = m.material; }
      m.material = __dashPatternMat;
    });
  } else if (__dashDebugMeshes.length && __dashDebugState===2) {
    __dashDebugMeshes.forEach(m=>{
      if(!m._origMats){ m._origMats = m.material; }
      const solid = new THREE.MeshBasicMaterial({ color:0xffaa00, side:THREE.DoubleSide });
      if (!m._solidMat) m._solidMat = solid;
      m.material = m._solidMat;
    });
  } else if (__dashDebugMeshes.length) {
    __dashDebugMeshes.forEach(m=>{ if(m._origMats) m.material = m._origMats; });
  }
  if (__dashOverlayPlane) {
    __dashOverlayPlane.visible = (__dashDebugState===3);
  }
  // existing bbox/wireframe logic
  if (__dashDebugMeshes.length && window.__dashShowBBox) {
    if (!__dashBBoxHelpers.length) {
      __dashDebugMeshes.forEach(m=>{ const helper = new THREE.BoxHelper(m, 0xffff00); scene.add(helper); __dashBBoxHelpers.push(helper); });
    } else {
      __dashBBoxHelpers.forEach(h=>h.update());
    }
  } else if (__dashBBoxHelpers.length && !window.__dashShowBBox) {
    __dashBBoxHelpers.forEach(h=>scene.remove(h));
    __dashBBoxHelpers = [];
  }
  if (__dashDebugMeshes.length && window.__dashWire) {
    __dashDebugMeshes.forEach(m=>{ const mats = Array.isArray(m.material)?m.material:[m.material]; mats.forEach(mat=> mat.wireframe = true); });
  } else if (__dashDebugMeshes.length) {
    __dashDebugMeshes.forEach(m=>{ const mats = Array.isArray(m.material)?m.material:[m.material]; mats.forEach(mat=> { if(mat.wireframe) mat.wireframe=false; }); });
  }
  renderer.render(scene, activeRenderCamera || fallbackCamera);
}

// --- UV / Surrogate diagnostics ---
function createSurrogateDashPlane() {
  if (__dashSurrogatePlane) { return; }
  if (!__dashDebugMeshes.length) { return; }
  const ref = __dashDebugMeshes[0];
  const box = new THREE.Box3().setFromObject(ref);
  const size = box.getSize(new THREE.Vector3());
  const planeGeo = new THREE.PlaneGeometry(size.x || 0.5, size.y || size.z || 0.5, 1,1);
  const mat = new THREE.MeshBasicMaterial({ map: __dashPatternTex || (__dashTex||null), side:THREE.DoubleSide, toneMapped:false });
  const plane = new THREE.Mesh(planeGeo, mat);
  box.getCenter(plane.position);
  plane.lookAt(fallbackCamera.position);
  plane.position.add(new THREE.Vector3().subVectors(fallbackCamera.position, plane.position).normalize().multiplyScalar(0.02));
  scene.add(plane);
  __dashSurrogatePlane = plane;
  // ...existing code...
}

function repaintDashTest() {
  if (!__dashTex || !__dashTex.image) { return; }
  const canvas = __dashTex.image; const ctx = canvas.getContext('2d');
  canvas.width = 512; canvas.height = 512; // force square for clarity
  const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];
  for (let i=0;i<6;i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i*(canvas.width/6),0, canvas.width/6, canvas.height);
  }
  ctx.fillStyle = '#000'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign='center'; ctx.fillText('TEST', canvas.width/2, canvas.height/2+16);
  __dashTex.needsUpdate = true;
  // ...existing code...
}

function regenerateDashUVs() {
  if (!__dashDebugMeshes.length) { return; }
  __dashDebugMeshes.forEach(mesh => {
    const geo = mesh.geometry; if (!geo || !geo.attributes.position) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox; const size = new THREE.Vector3(); bb.getSize(size);
    // Determine dominant axes (largest size components) for planar projection
    const axes = [ {axis:'x', val:size.x}, {axis:'y', val:size.y}, {axis:'z', val:size.z} ].sort((a,b)=>b.val-a.val);
    const a1 = axes[0].axis; const a2 = axes[1].axis; // plane axes
    const pos = geo.attributes.position;
    const uv = new Float32Array((pos.count)*2);
    for (let i=0; i<pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const map = {x,y,z};
      const u = (map[a1] - bb.min[a1]) / (size[a1]||1);
      const v = (map[a2] - bb.min[a2]) / (size[a2]||1); // Remove 1.0 - to fix upside down
      uv[i*2] = u; uv[i*2+1] = v;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv,2));
    geo.attributes.uv.needsUpdate = true;
  // ...existing code...
  });
}
// --- END UV / Surrogate diagnostics ---