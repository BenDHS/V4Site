# Three.js GLTF Viewer

A minimal, dependency-free (CDN based) Three.js viewer to explore a Blender-exported `.gltf` or `.glb` model with orbit controls, lighting, environment map approximation, drag & drop, and framing.

## Folder Structure
```
public/
  index.html          # Entry page
  js/
    main.js           # Viewer logic
  models/
    scene.glb         # (Put your exported file here – name can differ)
```

## Export From Blender
1. Select the objects you want (or nothing to export everything).
2. File > Export > glTF 2.0
3. Format: Prefer **Binary (.glb)** for a single-file export.
4. Enable: + Materials, + Meshes, + Animations (if needed), + Cameras (optional)
5. Compression: (Optional) Draco if you want smaller files (then keep DRACO on in viewer).
6. Save as `scene.glb` (or another name) inside `public/models`.

If you export as separate `.gltf` + `.bin` + textures, copy all those files into `public/models` and update the path in `main.js`.

## Multiple Cameras & Cycling
If your Blender export includes cameras (check the Cameras checkbox when exporting), the viewer will:
- Detect all cameras in the glTF.
- Disable scroll-to-zoom if more than one camera is present.
- Use the mouse wheel to cycle through them (up = previous, down = next).
- Show an overlay like `Cam: 1/3 CameraName` in the bottom-right.

### Blender Tips for Cameras
- Name cameras meaningfully: `Front`, `Detail`, `WideShot`.
- To set a focus/target point for a camera, parent or add an Empty named `Target`, `Focus`, or similar as a child — the viewer searches for child names matching `/focus|target|look/i` and uses its world position as the orbit target.
- Ensure each camera is not hidden or disabled for rendering.

### Framing vs Cameras
- If no cameras are exported, the viewer frames the whole model once and normal orbit + zoom works.
- If cameras exist, framing (press `F`) still works for the currently loaded model but wheel cycles cameras.

## Set Model Path
Open `public/js/main.js` and edit:
```js
const MODEL_URL = '../models/scene.glb';
```
Change `scene.glb` to your actual file name. For a multi-file `.gltf`, use something like:
```js
const MODEL_URL = '../models/scene.gltf';
```

## Running Locally
Because browsers block `file://` loading of relative resources, run a local static server.

### Option 1: Python 3
From repo root (where `public` lives):
```powershell
python -m http.server 8000
```
Open: http://localhost:8000/public/

### Option 2: Node (npx serve)
```powershell
npx serve . -l 8000
```
Open: http://localhost:8000/public/

### Option 3: VS Code Live Server Extension
Install "Live Server" and right-click `index.html` > "Open with Live Server".

## Features
- Orbit / pan / zoom (mouse, touch) when no multi-camera set present
- Scroll-wheel camera cycling when multiple exported cameras exist
- Drag & drop a `.gltf` or `.glb` (and its resources) directly into the page
- Draco decoding via Google CDN (only used if model is Draco-compressed)
- Simple lighting + generated environment (PMREM)
- Auto frame (press `F` to refocus)
- Resource cleanup when loading a new model

## Drag & Drop Multi-file glTF
Drop all related files (e.g., `model.gltf`, `model.bin`, textures). The viewer rewrites URLs in the loader so they resolve from in-memory blobs.

## Framing
Press `F` to frame the currently loaded root object. After load, it frames automatically once (if no cameras) or the selected camera view is applied (if cameras present).

## Tweaks
Adjust camera starting position in `main.js`:
```js
camera.position.set(2.5, 2, 3.5);
```
Adjust exposure:
```js
renderer.toneMappingExposure = 1.0;
```
Remove environment map if you prefer only direct lights:
```js
scene.environment = null;
```

## Troubleshooting
| Issue | Fix |
|-------|-----|
| Black model / dark | Ensure materials, set `renderer.outputColorSpace = THREE.SRGBColorSpace`. |
| Textures missing | If multi-file glTF, copy textures and `.bin`. Or drag & drop all files together. |
| CORS errors | Use a local server, not `file://`. |
| Draco decode fail | Ensure you didn't strip Draco extension during export; or export without Draco. |
| Nothing loads | Check console (F12). Ensure `MODEL_URL` path correct relative to `index.html`. |
| Wheel still zooms | Only one or zero cameras detected; add more cameras or verify export. |
| Camera target off | Add a child Empty named `Target` under the camera in Blender. |

## License
You are free to use and modify this small viewer snippet.
