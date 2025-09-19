// Material configuration for SCREEN video texture
import * as THREE from 'three';

export function applyScreenMaterial(currentRoot) {
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
  videoTex.flipY = false; 
  
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
            emissiveIntensity: 0.5,
            toneMapped: true,
          });
          if (stdMat.map && 'colorSpace' in stdMat.map) stdMat.map.colorSpace = THREE.SRGBColorSpace;
          if (stdMat.emissiveMap && 'colorSpace' in stdMat.emissiveMap) stdMat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
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
}