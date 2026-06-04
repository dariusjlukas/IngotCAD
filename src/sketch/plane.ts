/**
 * A sketch plane: an oriented 2D frame embedded in world space. The 2D sketch's
 * (x, y) maps to world `origin + x·u + y·v`, with `n = u × v` the plane normal
 * (the direction an extrusion grows). Cardinal planes and faces both reduce to
 * this frame, so the rest of the sketcher stays plane-agnostic.
 */
import * as THREE from 'three'
import type { PlaneKind, SketchPlane, Transform, Vec3 } from '../document/types'
import { matrix4ToTransform } from '../geometry/transform'

// Canonical home is document/types; re-export so imports from './plane' work.
export type { PlaneKind, SketchPlane } from '../document/types'

export function cardinalPlane(kind: PlaneKind): SketchPlane {
  switch (kind) {
    case 'xy':
      return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }
    case 'xz':
      return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], n: [0, -1, 0] }
    case 'yz':
      return { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1], n: [1, 0, 0] }
  }
}

/** Derive a plane from a picked face: origin at the hit point, normal = face normal. */
export function planeFromFace(point: Vec3, normal: Vec3): SketchPlane {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2])
  if (n.lengthSq() < 1e-9) n.set(0, 0, 1)
  n.normalize()
  // A reference axis not parallel to n, to derive an in-plane basis.
  const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
  const u = new THREE.Vector3().crossVectors(ref, n).normalize()
  const v = new THREE.Vector3().crossVectors(n, u).normalize()
  return {
    origin: [point[0], point[1], point[2]],
    u: [u.x, u.y, u.z],
    v: [v.x, v.y, v.z],
    n: [n.x, n.y, n.z],
  }
}

function basisMatrix(plane: SketchPlane): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...plane.u),
    new THREE.Vector3(...plane.v),
    new THREE.Vector3(...plane.n),
  )
  m.setPosition(plane.origin[0], plane.origin[1], plane.origin[2])
  return m
}

/** Column-major 4×4 mapping plane-local → world. */
export function localToWorldMatrix(plane: SketchPlane): number[] {
  return basisMatrix(plane).toArray()
}

/** Column-major 4×4 mapping world → plane-local (for projecting the scene). */
export function worldToLocalMatrix(plane: SketchPlane): number[] {
  return basisMatrix(plane).invert().toArray()
}

/** The node transform that places a solid built in plane-local space onto the plane. */
export function planeToTransform(plane: SketchPlane): Transform {
  return matrix4ToTransform(basisMatrix(plane))
}

/** Same, but shifted by an in-plane offset (so a recentered profile lands where drawn). */
export function planeToNodeTransform(plane: SketchPlane, cx: number, cy: number): Transform {
  const m = basisMatrix(plane).multiply(new THREE.Matrix4().makeTranslation(cx, cy, 0))
  return matrix4ToTransform(m)
}
