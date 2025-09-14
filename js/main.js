// Three.js GLTF Viewer (Camera Cycling Mode)
// Locks viewport to exported glTF cameras; mouse wheel cycles cameras.

import * as THREE from 'three';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/DRACOLoader.js';

// If you exported e.g. scene.glb to models, set:
const MODEL_URL = './models/scene.glb'; // Change to your file name (.gltf or .glb)

// ...existing code...
