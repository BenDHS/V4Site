// Material configuration for IMG_6721.001
import * as THREE from 'three';

export function applyImg6721001Material(currentRoot) {
  currentRoot.traverse(obj => {
    if (obj.isMesh && obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((mat, idx) => {
        if ((mat.name || '').trim() === 'IMG_6721.001' && !mat.isMeshPhysicalMaterial) {
          // Convert to MeshPhysicalMaterial
          const physMat = new THREE.MeshPhysicalMaterial();
          if (mat.map) physMat.map = mat.map;
          if (mat.normalMap) physMat.normalMap = mat.normalMap;
          if (mat.roughnessMap) physMat.roughnessMap = mat.roughnessMap;
          if (mat.metalnessMap) physMat.metalnessMap = mat.metalnessMap;
          if (mat.emissiveMap) physMat.emissiveMap = mat.emissiveMap;
          if (mat.aoMap) physMat.aoMap = mat.aoMap;
          if (mat.color) physMat.color.copy(mat.color);
          if (mat.emissive) physMat.emissive.copy(mat.emissive);
          physMat.name = mat.name;
          
          // Material settings
          physMat.roughness = 0.2;
          physMat.metalness = 0.5;
          physMat.clearcoat = 0.3;
          physMat.clearcoatRoughness = 0.1;
          physMat.transmission = 0.0;
          physMat.thickness = 0.0;
          physMat.envMapIntensity = 1.0;
          physMat.color.set(0xffffff);
          physMat.needsUpdate = true;
          
          if (Array.isArray(obj.material)) {
            obj.material[idx] = physMat;
          } else {
            obj.material = physMat;
          }
        } else if ((mat.name || '').trim() === 'IMG_6721.001') {
          // Already a MeshPhysicalMaterial, just update properties
          mat.roughness = 0.2;
          mat.metalness = 0.5;
          mat.clearcoat = 0.3;
          mat.clearcoatRoughness = 0.1;
          mat.transmission = 0.0;
          mat.thickness = 0.0;
          mat.envMapIntensity = 1.0;
          mat.color.set(0xffffff);
          mat.needsUpdate = true;
        }
      });
    }
  });
}

export function applyImg6721001TextureFiltering(currentRoot) {
  currentRoot.traverse(obj => {
    if (obj.isMesh && obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(mat => {
        if ((mat.name || '').trim() === 'IMG_6721.001' && mat.map && mat.map.isTexture) {
          mat.map.minFilter = THREE.LinearFilter;
          mat.map.magFilter = THREE.LinearFilter;
          mat.map.generateMipmaps = false;
          mat.map.needsUpdate = true;
          if ('colorSpace' in mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          mat.needsUpdate = true;
          console.log('[Patch] Forced LinearFilter and disabled mipmaps for', mat.name);
        }
      });
    }
  });
}

export function logImg6721001MaterialDetails(currentRoot) {
  currentRoot.traverse(obj => {
    if (obj.isMesh && obj.material) {
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(mat => {
        if ((mat.name || '').trim() === 'IMG_6721.001') {
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach(key => {
            const tex = mat[key];
            if (tex && tex.image) {
              let w = tex.image.width, h = tex.image.height;
              if (typeof w === 'undefined' && tex.image instanceof HTMLCanvasElement) {
                w = tex.image.width; h = tex.image.height;
              }
              console.log('[TextureInfo]', {
                material: mat.name,
                type: key,
                width: w,
                height: h,
                minFilter: tex.minFilter,
                magFilter: tex.magFilter,
                generateMipmaps: tex.generateMipmaps,
                colorSpace: tex.colorSpace
              });
            }
          });
          const present = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].filter(k => !!mat[k]);
          console.log('[MaterialInfo]', {
            material: mat.name,
            presentTextures: present,
            isMeshStandard: !!mat.isMeshStandardMaterial,
            isMeshPhysical: !!mat.isMeshPhysicalMaterial,
            isMeshBasic: !!mat.isMeshBasicMaterial
          });
        }
      });
    }
  });
}