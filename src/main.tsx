import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import './index.css'
import App from './App'

// 3D printing is intrinsically Z-up (bed = XY plane, build height = Z). Make
// Z-up the law of the land before anything renders so cameras, OrbitControls
// and TransformControls all agree. See geometry/transform.ts for the only
// place coordinate/angle conversions live.
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1)

// StrictMode is intentionally omitted: the viewport mixes imperative three.js
// (TransformControls, WASM engine) with React, and double-invoked effects make
// gizmo attach/detach and engine bootstrap harder to reason about for no gain.
createRoot(document.getElementById('root')!).render(<App />)
