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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { applyImg6721001Material, applyImg6721001TextureFiltering, logImg6721001MaterialDetails } from './materials/img-6721-001.js';
import { applyScreenMaterial } from './materials/screen.js';
import { applyDashMaterial } from './materials/dash.js';
import { applyLiveryMaterial } from './materials/livery.js';

// If you exported e.g. scene.glb to public/models, set:
const MODEL_URL = './models/scene.glb'; // Change to your file name (.gltf or .glb)

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const progressEl = document.getElementById('progress');
const errorEl = document.getElementById('error');
const dropzoneEl = document.getElementById('dropzone');

let renderer, scene, currentRoot;
let computerCamera = null; // The single animated COMPUTER camera
let clock = new THREE.Clock();
let __dashTex = null; let __dashMatRefs = [];
let __dashDebugMeshes = []; let __dashPatternMat = null; let __dashBBoxHelpers = []; let __dashWire = false;
let __dashOverlayPlane = null; let __dashDebugState = 0; // 0 normal,1 pattern,2 solid,3 overlay
let __dashPatternTex = null; let __dashSurrogatePlane = null;

// --- ANIMATION SYSTEM ---
let animationMixer = null;
let introAnimationClip = null; 
let introAnimationAction = null;
let hasPlayedIntroAnimation = false;
let isIntroAnimationPlaying = false;
let firstInteractionDetected = false;
let secondInteractionDetected = false;
let animationPhase = 'waiting-first'; // 'waiting-first', 'playing-to-48', 'paused-at-48', 'playing-to-96', 'completed'
let frame48Time = 0;
let frame96Time = 0;

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
  // Use a widely supported tone mapping (Neutral may be undefined in some builds)
  const __tm = (typeof THREE.ACESFilmicToneMapping !== 'undefined') ? THREE.ACESFilmicToneMapping
             : (typeof THREE.ReinhardToneMapping !== 'undefined') ? THREE.ReinhardToneMapping
             : THREE.LinearToneMapping;
  renderer.toneMapping = __tm;
  console.log('[Renderer] toneMapping chosen =', renderer.toneMapping, {
    ACESFilmicToneMapping: THREE.ACESFilmicToneMapping,
    ReinhardToneMapping: THREE.ReinhardToneMapping,
    LinearToneMapping: THREE.LinearToneMapping
  });
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  window.addEventListener('resize', onWindowResize);
  // Wheel (mouse & trackpad) handler (passive:false so we can prevent default)
  window.addEventListener('wheel', onWheel, { passive: false });
  
  // General click handler for interaction detection
  window.addEventListener('click', handleInteraction, { once: false });
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

      // Apply material configurations from external modules
      applyImg6721001Material(currentRoot);
      applyLiveryMaterial(currentRoot);
      applyScreenMaterial(currentRoot);
      
      // Apply dash material with global state
      const globalDashState = {
        __dashTex,
        __dashMatRefs,
        __dashDebugMeshes
      };
      applyDashMaterial(currentRoot, globalDashState);

      // Apply texture filtering
      applyImg6721001TextureFiltering(currentRoot);

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
            if (mat.map && 'colorSpace' in mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            if (mat.emissiveMap && 'colorSpace' in mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            mat.needsUpdate = true;
          });
        }
      });

      // --- END MATERIAL ENHANCEMENT ---
      // --- END MATERIAL ENHANCEMENT ---

        // Log IMG_6721.001 material details
        logImg6721001MaterialDetails(currentRoot);

        // --- FORCE CHECKERBOARD PATTERN ON ALL MESHES FOR UV DEBUG ---
        // Set window.__forceAllPattern = true in the console to enable
        window.__forceAllPattern = false;
        function applyPatternToAllMeshes() {
          if (!__dashPatternMat) return;
          currentRoot.traverse(obj => {
            if (obj.isMesh) {
              if (!obj._origMaterial) obj._origMaterial = obj.material;
              obj.material = window.__forceAllPattern ? __dashPatternMat : obj._origMaterial;
            }
          });
        }
        // Watch for changes to window.__forceAllPattern
        Object.defineProperty(window, '__forceAllPattern', {
          set(val) {
            this._forceAllPattern = val;
            applyPatternToAllMeshes();
          },
          get() {
            return this._forceAllPattern;
          },
          configurable: true
        });
        // Optionally, auto-enable for first load (set to true to force pattern on load)
        // window.__forceAllPattern = true;



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
        if (computerCamera) {
          plane.lookAt(computerCamera.position);
          // offset slightly so it is not z-fighting
          const forward = new THREE.Vector3().subVectors(computerCamera.position, plane.position).normalize();
          plane.position.add(forward.multiplyScalar(0.01));
        }
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

      // Find the COMPUTER camera
      computerCamera = currentRoot.getObjectByName('COMPUTER');
      if (computerCamera && computerCamera.isCamera) {
        console.log('Found COMPUTER camera');
        // Update camera aspect ratio for current window size
        computerCamera.aspect = window.innerWidth / window.innerHeight;
        computerCamera.updateProjectionMatrix();
      } else {
        console.error('COMPUTER camera not found in GLTF! Make sure your camera is named "COMPUTER" in Blender.');
      }

      // Setup animation system
      setupAnimationSystem(gltf);
      
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

function setupAnimationSystem(gltf) {
  // Reset animation state
  animationMixer = null;
  introAnimationClip = null;
  introAnimationAction = null;
  hasPlayedIntroAnimation = false;
  isIntroAnimationPlaying = false;
  firstInteractionDetected = false;
  secondInteractionDetected = false;
  animationPhase = 'waiting-first';
  frame48Time = 0;
  frame96Time = 0;

  // Check if there are animations in the GLTF
  if (gltf.animations && gltf.animations.length > 0) {
    console.log(`Found ${gltf.animations.length} animation(s) in GLTF`);
    
    // Log detailed animation information
    gltf.animations.forEach((clip, clipIndex) => {
      console.log(`\n--- Animation ${clipIndex}: "${clip.name || 'Unnamed'}" ---`);
      console.log(`Duration: ${clip.duration.toFixed(2)}s`);
      console.log(`Tracks: ${clip.tracks.length}`);
      
      // Log each animated track (object/property being animated)
      clip.tracks.forEach((track, trackIndex) => {
        const targetName = track.name.split('.')[0]; // Extract object name
        const propertyName = track.name.split('.')[1]; // Extract property (position, rotation, scale)
        console.log(`  Track ${trackIndex}: ${targetName} → ${propertyName} (${track.times.length} keyframes)`);
      });
    });
    
    // Create animation mixer
    animationMixer = new THREE.AnimationMixer(currentRoot);
    
    // Use the first animation as the intro animation
    introAnimationClip = gltf.animations[0];
    introAnimationAction = animationMixer.clipAction(introAnimationClip);
    
    // Calculate frame times (assuming 24fps)
    const fps = 24;
    frame48Time = 48 / fps;
    frame96Time = 96 / fps;
    
    // Configure the animation to play once but we'll control it manually
    introAnimationAction.setLoop(THREE.LoopOnce);
    introAnimationAction.clampWhenFinished = true;
    
    // Listen for animation completion (this will now happen at frame 96)
    animationMixer.addEventListener('finished', (event) => {
      if (event.action === introAnimationAction) {
        console.log('Intro animation completed at frame 96');
        hasPlayedIntroAnimation = true;
        isIntroAnimationPlaying = false;
        animationPhase = 'completed';
      }
    });
    
    console.log(`\nIntro animation setup: "${introAnimationClip.name || 'Unnamed'}" (${introAnimationClip.duration.toFixed(2)}s)`);
    console.log(`Frame 48 time: ${frame48Time.toFixed(2)}s, Frame 96 time: ${frame96Time.toFixed(2)}s`);
    
  } else {
    // No animations found
    console.log('No animations found in GLTF');
  }

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





// Handle user interactions to control animation phases
function handleInteraction() {
  if (!firstInteractionDetected) {
    // First interaction - start animation to frame 48
    firstInteractionDetected = true;
    
    if (introAnimationAction && animationPhase === 'waiting-first') {
      console.log('First interaction detected - starting animation to frame 48');
      console.log('Animated camera:', computerCamera ? computerCamera.name : 'NOT FOUND');
      animationPhase = 'playing-to-48';
      isIntroAnimationPlaying = true;
      introAnimationAction.reset();
      introAnimationAction.play();
    }
  } else if (!secondInteractionDetected && animationPhase === 'paused-at-48') {
    // Second interaction - continue animation to frame 96
    secondInteractionDetected = true;
    console.log('Second interaction detected - continuing animation to frame 96');
    animationPhase = 'playing-to-96';
    isIntroAnimationPlaying = true;
    // Don't reset, just continue from where we paused
  }
}

function onWheel(e) {
  e.preventDefault();
  // Handle interaction to control animation
  handleInteraction();
}

function setupTouch() {
  window.addEventListener('touchstart', (e)=>{
    // Handle interaction to control animation
    handleInteraction();
  }, { passive: true });
}

function setupButtons() {
  const nav = document.getElementById('camNav');
  if (!nav) return;
  const prevBtn = nav.querySelector('[data-cam-prev]');
  const nextBtn = nav.querySelector('[data-cam-next]');
  if (prevBtn) prevBtn.addEventListener('click', handleInteraction);
  if (nextBtn) nextBtn.addEventListener('click', handleInteraction);
}


function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      handleInteraction();
    }
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
  if (computerCamera && computerCamera.isPerspectiveCamera) {
    computerCamera.aspect = window.innerWidth / window.innerHeight;
    computerCamera.updateProjectionMatrix();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  
  // Update animation mixer with frame-based control
  if (animationMixer && isIntroAnimationPlaying && introAnimationAction) {
    const delta = clock.getDelta();
    
    // Check current animation time before updating
    const currentTime = introAnimationAction.time;
    
    // Update the mixer
    animationMixer.update(delta);
    
    // Check if we need to pause at frame 48
    if (animationPhase === 'playing-to-48' && introAnimationAction.time >= frame48Time) {
      console.log('Pausing animation at frame 48');
      animationPhase = 'paused-at-48';
      isIntroAnimationPlaying = false;
      // Set the time exactly to frame 48 to avoid overshooting
      introAnimationAction.time = frame48Time;
    }
    
    // Check if we've reached frame 96 in the second phase
    if (animationPhase === 'playing-to-96' && introAnimationAction.time >= frame96Time) {
      console.log('Animation completed at frame 96');
      animationPhase = 'completed';
      hasPlayedIntroAnimation = true;
      isIntroAnimationPlaying = false;
      // Set the time exactly to frame 96
      introAnimationAction.time = frame96Time;
    }
  }
  
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
  // Always render from COMPUTER camera
  if (computerCamera) {
    renderer.render(scene, computerCamera);
  } else {
    console.error('No COMPUTER camera available for rendering');
  }
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
  if (computerCamera) {
    plane.lookAt(computerCamera.position);
    plane.position.add(new THREE.Vector3().subVectors(computerCamera.position, plane.position).normalize().multiplyScalar(0.02));
  }
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
  });
}
// --- END UV / Surrogate diagnostics ---