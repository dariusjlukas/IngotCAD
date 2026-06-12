/**
 * Pick a feature edge from a click on a mesh face. We take the coplanar face
 * under the cursor (every triangle sharing the clicked triangle's plane) and
 * return the boundary edge of that face nearest the hit point. Boundary edges
 * are shared by only one triangle of the face, so interior tessellation diagonals
 * (e.g. the diagonal splitting a box-side quad) are never picked. Endpoints are
 * returned in the geometry's local space.
 *
 * The boundary collection itself lives in src/geometry/edges.ts (shared with
 * circle detection and the engine's edge treatments).
 */
import * as THREE from 'three'
import type { Vec3 } from '../document/types'
import { collectCoplanarBoundary } from '../geometry/edges'

export interface PickedEdge {
  a: Vec3
  b: Vec3
}

export function nearestCoplanarBoundaryEdge(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
  localPoint: THREE.Vector3,
): PickedEdge | null {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const boundary = collectCoplanarBoundary(
    { position: pos.array as ArrayLike<number>, index: geometry.index?.array ?? null },
    faceIndex,
  )
  if (!boundary) return null

  let best: PickedEdge | null = null
  let bestD = Infinity
  const A = new THREE.Vector3()
  const B = new THREE.Vector3()
  for (const e of boundary.edges) {
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
