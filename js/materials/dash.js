// Material configuration for DASHNEW/DASH interactive canvas material
import * as THREE from 'three';

export function applyDashMaterial(currentRoot) {
  const dashDiv = document.getElementById('dash-ui');
  const dashCanvas = document.createElement('canvas');
  dashCanvas.width = 512; 
  dashCanvas.height = 320;
  const dashCtx = dashCanvas.getContext('2d');
  
  const dashTex = new THREE.CanvasTexture(dashCanvas);
  dashTex.flipY = false; // Prevent Three.js from flipping the canvas (default true)
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
    dashCtx.clearRect(0, 0, dashCanvas.width, dashCanvas.height);
    // Draw background
    dashCtx.fillStyle = '#181c24';
    dashCtx.fillRect(0, 0, dashCanvas.width, dashCanvas.height);
    // Draw title
    dashCtx.font = 'bold 32px sans-serif';
    dashCtx.fillStyle = '#fff';
    dashCtx.textAlign = 'center';
    dashCtx.fillText('DASH MENU', dashCanvas.width / 2, 60);
    // Draw buttons
    const btns = [
      { label: 'Option 1', y: 120, color: '#2a7cff' },
      { label: 'Option 2', y: 180, color: '#2a7cff' },
      { label: 'Settings', y: 240, color: '#444' }
    ];
    dashCtx.font = '20px sans-serif';
    btns.forEach((btn, i) => {
      dashCtx.fillStyle = btn.color;
      dashCtx.fillRect(dashCanvas.width / 2 - 90, btn.y - 24, 180, 40);
      dashCtx.fillStyle = '#fff';
      dashCtx.fillText(btn.label, dashCanvas.width / 2, btn.y + 4);
    });
    // Flip canvas vertically for correct UV orientation
    flipCanvasY(dashCanvas);
  }
  
  renderDashToCanvas();
  // Update texture on click (simulate interactivity)
  if (dashDiv) {
    dashDiv.addEventListener('click', renderDashToCanvas);
  }
  
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
        ensureDashMaterial(mat, dashTex);
        dashApplied = true;
        dashCandidateMeshes.push(obj);
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