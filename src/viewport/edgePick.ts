/**
 * Pick a feature edge from a click on a mesh face. We take the coplanar face
 * under the cursor (every triangle sharing the clicked triangle's plane) and
 * return the boundary edge of that face nearest the hit point. Boundary edges
 * are shared by only one triangle of the face, so interior tessellation diagonals
 * (e.g. the diagonal splitting a box-side quad) are never picked. Endpoints are
 * returned in the geometry's local space.
 */
import * as THREE from 'three'
import type { Vec3 } from '../document/types'

export interface PickedEdge {
  a: Vec3
  b: Vec3
}

const COPLANAR_DOT = 0.9995
const COPLANAR_OFF = 1e-2

export function nearestCoplanarBoundaryEdge(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): PickedEdge | null {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const index = geometry.index
  const triCount = (index ? index.count : pos.count) / 3
  if (faceIndex < 0 || faceIndex >= triCount) return null
  const vi = (i: number) => (index ? index.getX(i) : i)

  const va = new THREE.Vector3()
  const vb = new THREE.Vector3()
  const vc = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const nrm = new THREE.Vector3()

  /** Fill va/vb/vc with triangle t's verts; return its plane (unit normal + offset). */
  const planeOf = (t: number): { nx: number; ny: number; nz: number; off: number } | null => {
    va.fromBufferAttribute(pos, vi(3 * t))
    vb.fromBufferAttribute(pos, vi(3 * t + 1))
    vc.fromBufferAttribute(pos, vi(3 * t + 2))
    ab.subVectors(vb, va)
    ac.subVectors(vc, va)
    nrm.crossVectors(ab, ac)
    if (nrm.lengthSq() < 1e-12) return null
    nrm.normalize()
    return { nx: nrm.x, ny: nrm.y, nz: nrm.z, off: nrm.dot(va) }
  }

  const target = planeOf(faceIndex)
  if (!target) return null

  // Quantize vertex positions so welded (shared) vertices key identically.
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
  const edges = new Map<string, { count: number; a: Vec3; b: Vec3 }>()
  const addEdge = (p: THREE.Vector3, q: THREE.Vector3) => {
    const kp = key(p.x, p.y, p.z)
    const kq = key(q.x, q.y, q.z)
    const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`
    const e = edges.get(k)
    if (e) e.count++
    else edges.set(k, { count: 1, a: [p.x, p.y, p.z], b: [q.x, q.y, q.z] })
  }

  for (let t = 0; t < triCount; t++) {
    const pl = planeOf(t) // also sets va/vb/vc to triangle t
    if (!pl) continue
    const dot = target.nx * pl.nx + target.ny * pl.ny + target.nz * pl.nz
    if (dot <= COPLANAR_DOT || Math.abs(pl.off - target.off) >= COPLANAR_OFF) continue
    addEdge(va, vb)
    addEdge(vb, vc)
    addEdge(vc, va)
  }

  let best: PickedEdge | null = null
  let bestD = Infinity
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  for (const e of edges.values()) {
    if (e.count !== 1) continue // boundary edges only
    A.set(...e.a)
    B.set(...e.b)
    const d = distToSegment(localPoint, A, B)
    if (d < bestD) {
      bestD = d
      best = { a: e.a, b: e.b }
    }
  }
  return best
}

/** Nearest of the clicked triangle's three vertices to `localPoint` (local space). */
export function nearestTriangleVertex(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): Vec3 | null {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const index = geometry.index
  const triCount = (index ? index.count : pos.count) / 3
  if (faceIndex < 0 || faceIndex >= triCount) return null
  const vi = (i: number) => (index ? index.getX(i) : i)
  const v = new THREE.Vector3()
  let best: Vec3 | null = null
  let bestD = Infinity
  for (let k = 0; k < 3; k++) {
    v.fromBufferAttribute(pos, vi(3 * faceIndex + k))
    const d = v.distanceToSquared(localPoint)
    if (d < bestD) {
      bestD = d
      best = [v.x, v.y, v.z]
    }
  }
  return best
}

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a)
  const t = THREE.MathUtils.clamp(
    new THREE.Vector3().subVectors(p, a).dot(ab) / (ab.lengthSq() || 1),
    0,
    1,
  )
  return new THREE.Vector3().copy(a).addScaledVector(ab, t).distanceTo(p)
}
