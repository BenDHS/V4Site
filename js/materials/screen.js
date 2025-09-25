// Material configuration for SCREEN video texture
import * as THREE from 'three';

export function applyScreenMaterial(currentRoot) {
  // Create video element (hidden, for 3D texture)
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

  // Store reference to screen meshes and materials for hover/click handling
  const screenMeshes = [];
  const screenMaterials = [];
  let isHovering = false;
  
  currentRoot.traverse(obj => {
    if (obj.isMesh && obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if ((mat.name || '').toUpperCase() === 'SCREEN') {
          screenMeshes.push(obj);
        }
      });
    }
  });

  // Helper function to check if mouse is hovering over screen
  function checkHover(e, rendererEl) {
    const camera = window.computerCamera || (window.scene && window.scene.getObjectByName && window.scene.getObjectByName('COMPUTER'));
    if (!camera) return false;

    const rect = rendererEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    
    const intersects = raycaster.intersectObjects(screenMeshes, false);
    return intersects.length > 0;
  }

  // Add hover and click handlers to make screen meshes interactive
  if (screenMeshes.length > 0) {
    const rendererEl = document.querySelector('canvas');
    if (rendererEl) {
      // Mouse move handler for hover effects
      rendererEl.addEventListener('mousemove', function(e) {
        const wasHovering = isHovering;
        isHovering = checkHover(e, rendererEl);
        
        if (isHovering !== wasHovering) {
          // Update cursor style
          rendererEl.style.cursor = isHovering ? 'pointer' : 'default';
          
          // Update material properties for hover effect
          screenMaterials.forEach(material => {
            if (isHovering) {
              // Increase brightness and glow on hover
              material.emissiveIntensity = 0.8;
              material.color.setScalar(1.2); // Slightly brighter
            } else {
              // Reset to normal values
              material.emissiveIntensity = 0.5;
              material.color.setScalar(1.0);
            }
          });
        }
      });

      // Mouse leave handler to reset hover state
      rendererEl.addEventListener('mouseleave', function() {
        isHovering = false;
        rendererEl.style.cursor = 'default';
        screenMaterials.forEach(material => {
          material.emissiveIntensity = 0.5;
          material.color.setScalar(1.0);
        });
      });

      // Click handler
      rendererEl.addEventListener('click', function(e) {
        if (checkHover(e, rendererEl)) {
          console.log('Screen clicked, opening bmercer.xyz');
          window.open('https://bmercer.xyz', '_blank');
        }
      });
    }
  }
  
  // Create Three.js texture
  const videoTex = new THREE.VideoTexture(video);
  videoTex.colorSpace = THREE.SRGBColorSpace;
  videoTex.minFilter = THREE.LinearFilter;
  videoTex.magFilter = THREE.LinearFilter;
  videoTex.generateMipmaps = false;
  videoTex.flipY = false; 
  
  // Find mesh/material named 'SCREEN' and apply video texture
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
            emissiveIntensity: 0.5, // Base intensity, will be modified on hover
            toneMapped: true,
          });
          if (stdMat.map && 'colorSpace' in stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;
          if (stdMat.emissiveMap && 'colorSpace' in stdMat.emissiveMap) stdMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
          stdMat.needsUpdate = true;
          
          // Store reference to the material for hover effects
          screenMaterials.push(stdMat);
          
          if (Array.isArray(obj.material)) {
            obj.material[idx] = stdMat;
          } else {
            obj.material = stdMat;
          }
        }
      });
    }
  });
}