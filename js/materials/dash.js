// Material configuration for DASHNEW/DASH interactive canvas material
import * as THREE from 'three';

export function applyDashMaterial(currentRoot) {
  const dashDiv = document.getElementById('dash-ui');
  const dashCanvas = document.createElement('canvas');
  dashCanvas.width = 512; 
  dashCanvas.height = 256; // Reduce height for better aspect ratio
  const dashCtx = dashCanvas.getContext('2d');
  
  const dashTex = new THREE.CanvasTexture(dashCanvas);
  dashTex.flipY = true; // Try without Three.js Y-flip
  dashTex.colorSpace = THREE.SRGBColorSpace;
  dashTex.minFilter = THREE.LinearFilter;
  dashTex.magFilter = THREE.LinearFilter;
  dashTex.generateMipmaps = false;
  
  // Track button bounds in canvas pixel coordinates (unflipped space)
  const buttonRects = {
    CODE: { x: 0, y: 0, w: 0, h: 0 },
    RESET: { x: 0, y: 0, w: 0, h: 0 },
  };

  // Helper to draw UI to canvas with inverted Y coordinates
  function renderDashToCanvas() {
    dashCtx.clearRect(0, 0, dashCanvas.width, dashCanvas.height);
    
    // Save current transform
    dashCtx.save();
    
    // Flip the canvas coordinate system vertically
    dashCtx.scale(1, -1);
    dashCtx.translate(0, -dashCanvas.height);
    
  // Layout
  const padding = 28;
  const centerX = dashCanvas.width / 2;
  const centerY = dashCanvas.height / 2;
    
    // Draw background
    dashCtx.fillStyle = '#181c24';
    dashCtx.fillRect(0, 0, dashCanvas.width, dashCanvas.height);
    
  // Title
  dashCtx.font = 'bold 22px sans-serif';
    dashCtx.fillStyle = '#fff';
    dashCtx.textAlign = 'center';
  dashCtx.fillText('>CODE<', centerX, padding + 18);
    
    // Buttons: CODE and RESET
    dashCtx.font = 'bold 16px sans-serif';
    const buttonWidth = Math.min(220, dashCanvas.width - padding * 2);
    const buttonHeight = 40;
    const gap = 14;
    const firstY = centerY - (buttonHeight + gap) / 2;
    const secondY = centerY + (buttonHeight + gap) / 2;

    // CODE button
    dashCtx.fillStyle = '#2a7cff';
    const codeX = centerX - buttonWidth / 2;
    const codeY = firstY - buttonHeight / 2;
    dashCtx.fillRect(codeX, codeY, buttonWidth, buttonHeight);
    dashCtx.fillStyle = '#fff';
    dashCtx.fillText('CODE', centerX, firstY + 5);
    // Store unflipped bounds (note: we are in flipped drawing space; convert to canvas space)
    buttonRects.CODE = { x: codeX, y: dashCanvas.height - (codeY + buttonHeight), w: buttonWidth, h: buttonHeight };

    // RESET button
    dashCtx.fillStyle = '#444';
    const resetX = centerX - buttonWidth / 2;
    const resetY = secondY - buttonHeight / 2;
    dashCtx.fillRect(resetX, resetY, buttonWidth, buttonHeight);
    dashCtx.fillStyle = '#fff';
    dashCtx.fillText('RESET', centerX, secondY + 5);
    buttonRects.RESET = { x: resetX, y: dashCanvas.height - (resetY + buttonHeight), w: buttonWidth, h: buttonHeight };
    
    // Restore transform
    dashCtx.restore();
  }
  
  renderDashToCanvas();
  // Update texture on click (simulate interactivity)
  if (dashDiv) {
    dashDiv.addEventListener('click', renderDashToCanvas);
  }

  
  // Find mesh/material named 'DASHNEW' (backward compatible: also matches legacy 'DASH')
  let dashApplied = false;
  const dashCandidateMeshes = [];
  // Track exact mesh/material targets so we can fit texture to their UV islands
  const dashTargets = [];
  
  currentRoot.traverse(obj => {
    if (!obj.isMesh) return;
    const meshName = (obj.name || '').trim().toUpperCase();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    materials.forEach((mat, idx) => {
      const rawName = (mat?.name || '').trim();
      const matName = rawName.toUpperCase();
      const isDash = mat && (matName === 'DASHNEW' || matName.includes('DASHNEW') || matName === 'DASH' || matName.includes('DASH') || meshName.includes('DASHNEW') || meshName.includes('DASH'));
      if (isDash) {
        ensureDashMaterial(mat, dashTex);
        dashApplied = true;
        dashCandidateMeshes.push(obj);
        dashTargets.push({ mesh: obj, index: idx });
      }
    });
  });
  
  if (!dashApplied) {
    const targetMesh = findLargestMesh(currentRoot);
    if (targetMesh) {
      const basicMat = new THREE.MeshBasicMaterial({ map: dashTex });
      basicMat.name = 'DASHNEW_FALLBACK';
      targetMesh.material = basicMat;
      dashApplied = true;
    }
  }
  
  // Fit the dash texture to the UV island used by each target material, so the
  // full canvas fills the material's mapped region regardless of atlas coords.
  dashTargets.forEach(({ mesh, index }) => {
    const geom = mesh.geometry;
    const uvAttr = geom && geom.attributes && geom.attributes.uv;
    if (!uvAttr) return;

    let uMin = Infinity, vMin = Infinity, uMax = -Infinity, vMax = -Infinity;
    const uvArray = uvAttr.array;
    for (let i = 0; i < uvAttr.count; i++) {
      const u = uvArray[i * 2 + 0];
      const v = uvArray[i * 2 + 1];
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }

    const uSize = Math.max(1e-6, uMax - uMin);
    const vSize = Math.max(1e-6, vMax - vMin);

    // r = 1/size, o = -min/size to map [uMin..uMax] -> [0..1]
    const rU = 1 / uSize;
    const rV = 1 / vSize;
    const oU = -uMin * rU;
    const oV = -vMin * rV;

    // Retrieve the exact target material
    const mat = Array.isArray(mesh.material) ? mesh.material[index] : mesh.material;
    if (!mat) return;

    // Clone base texture per material so transforms don't conflict across meshes
    const texClone = dashTex.clone();
    texClone.colorSpace = dashTex.colorSpace;
    texClone.minFilter = dashTex.minFilter;
    texClone.magFilter = dashTex.magFilter;
    texClone.generateMipmaps = dashTex.generateMipmaps;
    texClone.wrapS = THREE.ClampToEdgeWrapping;
    texClone.wrapT = THREE.ClampToEdgeWrapping;
    texClone.flipY = dashTex.flipY;

    texClone.repeat.set(rU, rV);
    texClone.offset.set(oU, oV);
    texClone.needsUpdate = true;

    mat.map = texClone;
    if ('emissiveMap' in mat) mat.emissiveMap = texClone;
    mat.needsUpdate = true;
  });

  // Add interactive click handling on the 3D canvas (after targets are ready)
  if (!window.__dashClickInstalled) {
    const rendererEl = document.querySelector('canvas');
    if (rendererEl && dashCandidateMeshes.length > 0) {
      window.__dashClickInstalled = true;
      rendererEl.addEventListener('click', (e) => {
        const camera = window.computerCamera;
        if (!camera) return;

        const rect = rendererEl.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
        const intersects = raycaster.intersectObjects(dashCandidateMeshes, false);
        if (!intersects.length) return;

        const hit = intersects[0];
        const obj = hit.object;
        const uv = hit.uv;
        if (!uv) return;

        const materialIndex = hit.face && typeof hit.face.materialIndex === 'number' ? hit.face.materialIndex : 0;
        const mat = Array.isArray(obj.material) ? obj.material[materialIndex] : obj.material;
        if (!mat || !mat.map) return;

        const tex = mat.map;
        const uFull = (uv.x - tex.offset.x) / (tex.repeat.x || 1);
        const vFull = (uv.y - tex.offset.y) / (tex.repeat.y || 1);

        const px = Math.round(uFull * dashCanvas.width);
        const py = Math.round((1 - vFull) * dashCanvas.height);

        const inRect = (r, x0, y0) => x0 >= r.x && x0 <= r.x + r.w && y0 >= r.y && y0 <= r.y + r.h;

        if (inRect(buttonRects.CODE, px, py)) {
          window.open('https://github.com/BMERCER-XYZ/V4Site', '_blank');
          return;
        }
        if (inRect(buttonRects.RESET, px, py)) {
          if (typeof window.resetIntroAnimation === 'function') {
            window.resetIntroAnimation();
          }
          return;
        }
      });
    }
  }
  
  function ensureDashMaterial(mat, tex) {
    if (!mat) return;
    
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
      mat.dispose?.();
      currentRoot.traverse(o => {
        if (o.isMesh) {
          if (Array.isArray(o.material)) {
            o.material = o.material.map(m => m === mat ? replacement : m);
          } else if (o.material === mat) {
            o.material = replacement;
          }
        }
      });
    }
    tex.needsUpdate = true;
  }
  
  function findLargestMesh(root) {
    let best = null; let bestVol = 0;
    const box = new THREE.Box3();
    root.traverse(o => {
      if (o.isMesh) {
        box.setFromObject(o);
        const v = box.getSize(new THREE.Vector3());
        const vol = v.x * v.y * v.z;
        if (vol > bestVol) {
          bestVol = vol; best = o;
        }
      }
    });
    return best;
  }
}