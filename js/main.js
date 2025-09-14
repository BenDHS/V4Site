// Three.js GLTF Viewer (Camera Cycling Mode)
// Locks viewport to exported glTF cameras; mouse wheel cycles cameras.

import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';

// If you exported e.g. scene.glb to public/models, set:
const MODEL_URL = '/public/models/scene.glb'; // Change to your file name (.gltf or .glb)

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

init();
loadInitial();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  // Fallback camera used when no glTF cameras exist
  fallbackCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
  fallbackCamera.position.set(2.5, 2, 3.5);
  activeRenderCamera = fallbackCamera;

  // Lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0, 50, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(5, 10, 7);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  scene.add(dir);

  const envGen = new THREE.PMREMGenerator(renderer);
  scene.environment = envGen.fromScene(createMinimalHDRI()).texture;

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('wheel', onWheel, { passive: false });

  setupDragAndDrop();
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
          mats.forEach(mat => {
            if ((mat.name || '').toUpperCase() === 'SCREEN') {
              mat.map = videoTex;
              mat.emissive = new THREE.Color(0xffffff); // full white emissive
              mat.emissiveIntensity = 1; // increase for more glow
              mat.emissiveMap = videoTex;
              mat.needsUpdate = true;
            }
          });
        }
      });
      // --- END VIDEO PATCH ---

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
            console.log('[DASH] Applying to material', rawName || '(no-name)', 'on mesh', obj.name, '(matched DASHNEW logic)');
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
          console.log('[DASH] Fallback material applied to mesh:', targetMesh.name);
        } else {
          console.warn('[DASH] No mesh available for fallback assignment.');
        }
      }
      function ensureDashMaterial(mat, tex) {
        if (!mat) return;
        __dashMatRefs.push(mat);
        // UV debug
        currentRoot.traverse(o=>{ if(o.isMesh && o.material===mat){ if(!o.geometry.attributes.uv){ console.warn('[DASH] Mesh', o.name, 'has NO UVs.'); } }});
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
          console.log('[DASH] Replacing non-standard material type with MeshBasicMaterial for UI display.');
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
        console.log('[DASH] Pattern material created.');
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
        console.log('[DASH] Overlay plane created size', planeW.toFixed(3), planeH.toFixed(3));
      }

      // Log detailed diagnostics for each dash material
      __dashMatRefs.forEach((m,i)=>{
        const hasMap = !!m.map; let dims='';
        if (m.map && m.map.image) { dims = (m.map.image.width||'?')+'x'+(m.map.image.height||'?'); }
        console.log(`[DASH] Mat#${i} type=${m.type} name=${m.name} map=${hasMap} dims=${dims}`);
      });

      // Auto-fix UV orientation on load (same as pressing U key)
      if (__dashDebugMeshes.length > 0) {
        console.log('[DASH] Auto-regenerating UVs to fix orientation...');
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

function onWheel(e) {
  if (!gltfCameras.length) return; // nothing to cycle
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  activeCamIndex = (activeCamIndex + dir + gltfCameras.length) % gltfCameras.length;
  applyActiveCamera(false);
}

function setupDragAndDrop() {
  const prevent = e => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter','dragover','dragleave','drop'].forEach(eventName => {
    window.addEventListener(eventName, prevent, false);
  });
  window.addEventListener('dragenter', () => { dropzoneEl.style.display = 'flex'; });
  window.addEventListener('dragleave', (e) => { if (e.target === document || e.target === window) dropzoneEl.style.display='none'; });
  window.addEventListener('drop', (e) => {
    dropzoneEl.style.display='none';
    const dt = e.dataTransfer;
    if (!dt?.files?.length) return;
    const files = Array.from(dt.files);
    const filesMap = new Map();
    let mainFile = null;
    files.forEach(f => {
      filesMap.set(f.name, f);
      if (f.name.match(/\.(gltf|glb)$/i)) mainFile = f;
    });
    if (!mainFile) {
      showError(new Error('No .gltf or .glb file found in drop.'));
      return;
    }
    const objectURL = URL.createObjectURL(mainFile);
    loadModel(objectURL, filesMap).finally(() => {
      setTimeout(() => URL.revokeObjectURL(objectURL), 60000);
    });
  });
}

function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') {
      if (gltfCameras.length) applyActiveCamera(false); else if (currentRoot) frameFallback(currentRoot);
    }
    if (e.key === 'ArrowRight') { if (gltfCameras.length) { activeCamIndex = (activeCamIndex+1)%gltfCameras.length; applyActiveCamera(); } }
    if (e.key === 'ArrowLeft') { if (gltfCameras.length) { activeCamIndex = (activeCamIndex-1+gltfCameras.length)%gltfCameras.length; applyActiveCamera(); } }
    if (e.key.toLowerCase() === 'b') { // toggle basic debug material
      __dashMatRefs.forEach(m => {
        if (!m) return;
        if (!m._origType) m._origType = m.type;
      });
      console.log('[DASH] (B) currently only stores types; pattern debug handled by G.');
    }
    if (e.key.toLowerCase() === 'g') { window.__dashForcePattern = !window.__dashForcePattern; console.log('[DASH] Pattern toggle', window.__dashForcePattern); }
    if (e.key.toLowerCase() === 'x') { __dashDebugState = (__dashDebugState+1)%4; console.log('[DASH] Debug mode', __dashDebugState, '0=normal 1=pattern 2=solid 3=overlay'); }
    if (e.key.toLowerCase() === 'h') { window.__dashShowBBox = !window.__dashShowBBox; console.log('[DASH] BBox toggle', window.__dashShowBBox); }
    if (e.key.toLowerCase() === 'w') { window.__dashWire = !window.__dashWire; console.log('[DASH] Wireframe toggle', window.__dashWire); }
    // Spawn surrogate plane with guaranteed good UVs
    if (e.key.toLowerCase() === 'p') { createSurrogateDashPlane(); }
    // Repaint dash canvas with high-contrast test
    if (e.key.toLowerCase() === 'r') { repaintDashTest(); }
    // Attempt procedural planar UV projection on DASH meshes
    if (e.key.toLowerCase() === 'u') { regenerateDashUVs(); }
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
  if (__dashSurrogatePlane) { console.log('[DASH] Surrogate plane already exists.'); return; }
  if (!__dashDebugMeshes.length) { console.warn('[DASH] No DASH debug meshes to align surrogate plane.'); return; }
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
  console.log('[DASH] Surrogate plane created; toggle debug modes to compare.');
}

function repaintDashTest() {
  if (!__dashTex || !__dashTex.image) { console.warn('[DASH] No dash canvas texture to repaint.'); return; }
  const canvas = __dashTex.image; const ctx = canvas.getContext('2d');
  canvas.width = 512; canvas.height = 512; // force square for clarity
  const colors = ['#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff'];
  for (let i=0;i<6;i++) {
    ctx.fillStyle = colors[i];
    ctx.fillRect(i*(canvas.width/6),0, canvas.width/6, canvas.height);
  }
  ctx.fillStyle = '#000'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign='center'; ctx.fillText('TEST', canvas.width/2, canvas.height/2+16);
  __dashTex.needsUpdate = true;
  console.log('[DASH] Repainted canvas with high-contrast bars.');
}

function regenerateDashUVs() {
  if (!__dashDebugMeshes.length) { console.warn('[DASH] No DASH meshes to regenerate UVs.'); return; }
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
    console.log(`[DASH] Regenerated planar UVs for mesh ${mesh.name} using axes ${a1}/${a2}.`);
  });
}
// --- END UV / Surrogate diagnostics ---