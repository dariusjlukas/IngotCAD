/**
 * Given a hovered triangle (faceIndex) of a mesh geometry, return the vertex
 * positions of the whole *coplanar face* — every triangle sharing the hovered
 * triangle's plane (same normal + same offset). For a box side that's the two
 * triangles of that face; for a cylinder cap, all cap triangles. Returned as a
 * non-indexed triangle soup in the geometry's local space, for a hover overlay.
 */
import * as THREE from 'three'

export function coplanarFacePositions(
  geometry: THREE.BufferGeometry,
  faceIndex: number,
): Float32Array | null {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined
  if (!pos) return null
  const index = geometry.index
  const triCount = (index ? index.count : pos.count) / 3
  if (faceIndex < 0 || faceIndex >= triCount) return null

  const vi = (i: number) => (index ? index.getX(i) : i)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const ab = new THREE.Vector3()
  const ac = new THREE.Vector3()
  const n = new THREE.Vector3()

  /** Fill a/b/c with triangle t's verts; return its plane (unit normal + offset). */
  const planeOf = (t: number): { nx: number; ny: number; nz: number; off: number } | null => {
    a.fromBufferAttribute(pos, vi(3 * t))
    b.fromBufferAttribute(pos, vi(3 * t + 1))
    c.fromBufferAttribute(pos, vi(3 * t + 2))
    ab.subVectors(b, a)
    ac.subVectors(c, a)
    n.crossVectors(ab, ac)
    if (n.lengthSq() < 1e-12) return null
    n.normalize()
    return { nx: n.x, ny: n.y, nz: n.z, off: n.dot(a) }
  }

  const target = planeOf(faceIndex)
  if (!target) return null

  const out: number[] = []
  for (let t = 0; t < triCount; t++) {
    const p = planeOf(t) // also sets a/b/c to triangle t
    if (!p) continue
    const dot = target.nx * p.nx + target.ny * p.ny + target.nz * p.nz
    if (dot > 0.9995 && Math.abs(p.off - target.off) < 1e-2) {
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    }
  }
  return out.length > 0 ? new Float32Array(out) : null
}
