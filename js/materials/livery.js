// Material configuration for mat_livery_0_157_001.004
import * as THREE from 'three';

export function applyLiveryMaterial(currentRoot) {
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
}