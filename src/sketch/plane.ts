/**
 * A sketch plane: an oriented 2D frame embedded in world space. The 2D sketch's
 * (x, y) maps to world `origin + x·u + y·v`, with `n = u × v` the plane normal
 * (the direction an extrusion grows). Cardinal planes and faces both reduce to
 * this frame, so the rest of the sketcher stays plane-agnostic.
 */
import * as THREE from 'three'
import type { PlaneDefinition, PlaneKind, SketchPlane, Transform, Vec3 } from '../document/types'
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

/** Shift a plane's origin `distance` mm along its normal (keeps the U/V/N basis). */
function offsetPlane(p: SketchPlane, distance: number): SketchPlane {
  return {
    ...p,
    origin: [
      p.origin[0] + p.n[0] * distance,
      p.origin[1] + p.n[1] * distance,
      p.origin[2] + p.n[2] * distance,
    ],
  }
}

/** Plane through three points: a = origin, a→b = U, normal = (b−a)×(c−a). */
export function planeFromThreePoints(a: Vec3, b: Vec3, c: Vec3): SketchPlane {
  const A = new THREE.Vector3(...a)
  const ab = new THREE.Vector3(...b).sub(A)
  const ac = new THREE.Vector3(...c).sub(A)
  let n = new THREE.Vector3().crossVectors(ab, ac)
  if (n.lengthSq() < 1e-12) n = new THREE.Vector3(0, 0, 1) // collinear → fall back to Z-up
  n.normalize()
  let u = ab.clone()
  if (u.lengthSq() < 1e-12) u = new THREE.Vector3(1, 0, 0) // a == b → arbitrary in-plane axis
  // Re-orthogonalize U against N (it already is when the points are valid).
  u.addScaledVector(n, -u.dot(n))
  if (u.lengthSq() < 1e-12) {
    // a→b parallel to the fallback normal (e.g. all three points collinear
    // along Z): projecting left nothing — derive an in-plane axis instead of
    // returning a singular zero basis.
    const ref = Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
    u = new THREE.Vector3().crossVectors(ref, n)
  }
  u.normalize()
  const v = new THREE.Vector3().crossVectors(n, u).normalize()
  return { origin: [...a], u: [u.x, u.y, u.z], v: [v.x, v.y, v.z], n: [n.x, n.y, n.z] }
}

/**
 * Plane hinged about an edge: start from `refNormal` (made perpendicular to the
 * edge), rotate it `angleDeg` about the edge `axis`, and keep the axis in-plane
 * (it becomes U, the hinge line). angle 0 reproduces the reference plane.
 */
export function planeFromEdgeAngle(
  origin: Vec3,
  axis: Vec3,
  refNormal: Vec3,
  angleDeg: number,
): SketchPlane {
  const ax = new THREE.Vector3(...axis)
  if (ax.lengthSq() < 1e-12) ax.set(1, 0, 0)
  ax.normalize()
  // Project the reference normal perpendicular to the axis.
  let n0 = new THREE.Vector3(...refNormal)
  n0.addScaledVector(ax, -n0.dot(ax))
  if (n0.lengthSq() < 1e-12) {
    // refNormal is parallel to the axis: choose any perpendicular to the axis.
    n0 = new THREE.Vector3(1, 0, 0).addScaledVector(ax, -ax.x)
    if (n0.lengthSq() < 1e-12) n0 = new THREE.Vector3(0, 1, 0).addScaledVector(ax, -ax.y)
  }
  n0.normalize()
  const n = n0.applyAxisAngle(ax, (angleDeg * Math.PI) / 180).normalize()
  const v = new THREE.Vector3().crossVectors(n, ax).normalize()
  return { origin: [...origin], u: [ax.x, ax.y, ax.z], v: [v.x, v.y, v.z], n: [n.x, n.y, n.z] }
}

/** Resolve a construction-plane definition to a concrete sketch-plane frame. */
export function resolvePlaneDefinition(def: PlaneDefinition): SketchPlane {
  switch (def.kind) {
    case 'offset':
      return offsetPlane(cardinalPlane(def.base), def.distance)
    case 'face':
      return offsetPlane(planeFromFace(def.origin, def.normal), def.distance)
    case 'threePoints':
      return planeFromThreePoints(def.a, def.b, def.c)
    case 'edgeAngle':
      return planeFromEdgeAngle(def.origin, def.axis, def.refNormal, def.angleDeg)
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
