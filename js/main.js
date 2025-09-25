import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { applyImg6721001Material, applyImg6721001TextureFiltering } from './materials/img-6721-001.js';
import { applyScreenMaterial } from './materials/screen.js';
import { applyDashMaterial } from './materials/dash.js';
import { applyLiveryMaterial } from './materials/livery.js';

const MODEL_URL = './models/scene.glb';

const container = document.getElementById('app');
const loadingEl = document.getElementById('loading');
const progressEl = document.getElementById('progress');
const errorEl = document.getElementById('error');

let renderer, scene, currentRoot;
let computerCamera = null; // The single animated COMPUTER camera
let clock = new THREE.Clock();
// Clamp animation delta to avoid big jumps after a pause/tab switch
const MAX_ANIM_DELTA = 0.05; // ~20 FPS per tick maximum fed to mixer

// --- ANIMATION SYSTEM ---
let animationMixer = null;
let introAnimationClip = null; 
let introAnimationAction = null;
let hasPlayedIntroAnimation = false;
let isIntroAnimationPlaying = false;
let firstInteractionDetected = false;
let secondInteractionDetected = false;
let thirdInteractionDetected = false;
let animationPhase = 'waiting-first'; // 'waiting-first', 'playing-to-48', 'paused-at-48', 'playing-to-98', 'paused-at-98', 'playing-to-135', 'completed'
let frame48Time = 0;
let frame98Time = 0;
let frame135Time = 0;

init();
loadInitial();
animate();

// Expose a global reset for the dash RESET button
window.resetIntroAnimation = function resetIntroAnimation() {
  if (!introAnimationAction || !animationMixer) return;
  // Reset state flags
  hasPlayedIntroAnimation = false;
  isIntroAnimationPlaying = false;
  firstInteractionDetected = false;
  secondInteractionDetected = false;
  thirdInteractionDetected = false;
  animationPhase = 'waiting-first';

  // Reset animation time and pause
  introAnimationAction.stop();
  introAnimationAction.reset();
  introAnimationAction.time = 0;
  introAnimationMixerSafeStop();
  // Ensure the next user interaction starts playback normally
  clock.getDelta();
};

function introAnimationMixerSafeStop() {
  try {
    // No-op helper for future extensibility
  } catch (_) {}
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const __tm = (typeof THREE.ACESFilmicToneMapping !== 'undefined') ? THREE.ACESFilmicToneMapping
             : (typeof THREE.ReinhardToneMapping !== 'undefined') ? THREE.ReinhardToneMapping
             : THREE.LinearToneMapping;
  renderer.toneMapping = __tm;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('wheel', onWheel, { passive: false });
  
  window.addEventListener('click', handleInteraction, { once: false });
  setupTouch();
  setupKeyboard();
}


function loadInitial() {
  if (!MODEL_URL) return;
  loadModel(MODEL_URL).catch(e => showError(e));
}

function showError(e) {
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

      applyImg6721001Material(currentRoot);
      applyLiveryMaterial(currentRoot);
      applyScreenMaterial(currentRoot);
      applyDashMaterial(currentRoot);

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


      // Apply texture filtering
      applyImg6721001TextureFiltering(currentRoot);

      // Find the COMPUTER camera
      computerCamera = currentRoot.getObjectByName('COMPUTER');
      if (computerCamera && computerCamera.isCamera) {
        // Update camera aspect ratio for current window size
        computerCamera.aspect = window.innerWidth / window.innerHeight;
        computerCamera.updateProjectionMatrix();
        window.computerCamera = computerCamera;
        window.scene = scene;
      } else {
      }

      // Setup animation system
      setupAnimationSystem(gltf);
      
      setProgress(1);
      resolve(gltf);
    }, xhrEvt => {
      if (xhrEvt.total) setProgress(xhrEvt.loaded / xhrEvt.total);
      else if (xhrEvt.loaded > 0) setProgress(undefined);
    }, err => {
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
  thirdInteractionDetected = false;
  animationPhase = 'waiting-first';
  frame48Time = 0;
  frame98Time = 0;
  frame135Time = 0;

  // Check if there are animations in the GLTF
  if (gltf.animations && gltf.animations.length > 0) {
    
    // Log detailed animation information
    gltf.animations.forEach((clip, clipIndex) => {
      
      // Log each animated track (object/property being animated)
      clip.tracks.forEach((track, trackIndex) => {
        const targetName = track.name.split('.')[0]; // Extract object name
        const propertyName = track.name.split('.')[1]; // Extract property (position, rotation, scale)
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
  frame98Time = 98 / fps;
  frame135Time = Math.min(135 / fps, introAnimationClip.duration);
    
    // Configure the animation to play once but we'll control it manually
    introAnimationAction.setLoop(THREE.LoopOnce);
    introAnimationAction.clampWhenFinished = true;
    
  // Listen for animation completion (end of clip); we also manually stop at frame 120
    animationMixer.addEventListener('finished', (event) => {
      if (event.action === introAnimationAction) {
        hasPlayedIntroAnimation = true;
        isIntroAnimationPlaying = false;
        animationPhase = 'completed';
      }
    });
    
    
  } else {
    // No animations found
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
  animationPhase = 'playing-to-48';
  // Flush any accumulated time so the first mixer.update doesn't jump
  clock.getDelta();
  isIntroAnimationPlaying = true;
      introAnimationAction.reset();
      introAnimationAction.play();
    }
  } else if (!secondInteractionDetected && animationPhase === 'paused-at-48') {
    // Second interaction - continue animation to frame 98
    secondInteractionDetected = true;
  animationPhase = 'playing-to-98';
  // Flush accumulated time so next mixer.update doesn't jump
  clock.getDelta();
  isIntroAnimationPlaying = true;
    // Don't reset, just continue from where we paused
  } else if (!thirdInteractionDetected && animationPhase === 'paused-at-98') {
    // Third interaction - continue animation to frame 135
    thirdInteractionDetected = true;
  animationPhase = 'playing-to-135';
  // Flush accumulated time so next mixer.update doesn't jump
  clock.getDelta();
  isIntroAnimationPlaying = true;
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

// ...existing code...


function setupKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      handleInteraction();
    }
  });
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
  
  // Always tick the clock; clamp delta when playing to avoid jumps
  const rawDelta = clock.getDelta();
  const playbackDelta = isIntroAnimationPlaying ? Math.min(rawDelta, MAX_ANIM_DELTA) : 0;
  
  // Update animation mixer with frame-based control
  if (animationMixer && introAnimationAction) {
    if (playbackDelta > 0) {
      // Update the mixer using clamped delta only while playing
      animationMixer.update(playbackDelta);
    }
    
    // Check if we need to pause at frame 48
    if (animationPhase === 'playing-to-48' && introAnimationAction.time >= frame48Time) {
      animationPhase = 'paused-at-48';
      isIntroAnimationPlaying = false;
      // Set the time exactly to frame 48 to avoid overshooting
      introAnimationAction.time = frame48Time;
    }
    
    // Check if we need to pause at frame 98 in the second phase
    if (animationPhase === 'playing-to-98' && introAnimationAction.time >= frame98Time) {
      animationPhase = 'paused-at-98';
      isIntroAnimationPlaying = false;
      introAnimationAction.time = frame98Time;
    }

    // Check if we've reached frame 135 in the third phase
    if (animationPhase === 'playing-to-135' && introAnimationAction.time >= frame135Time) {
      animationPhase = 'completed';
      hasPlayedIntroAnimation = true;
      isIntroAnimationPlaying = false;
      introAnimationAction.time = frame135Time;
    }
  }

  // Always render from COMPUTER camera
  if (computerCamera) {
    renderer.render(scene, computerCamera);
  }
}