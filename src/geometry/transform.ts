/**
 * Coordinate / angle conversions — the ONE place they live.
 *
 * The document stores degrees (matching Manifold). three.js Euler/Quaternion
 * work in radians. There is no axis conversion anywhere: the document, Manifold
 * and the three.js scene are all Z-up + millimeters. So the only conversion is
 * degrees <-> radians at the three.js boundary, plus composing/decomposing a
 * transform to/from a matrix.
 */
import * as THREE from 'three'
import type { Transform, Vec3 } from '../document/types'
import { IDENTITY_TRANSFORM } from '../document/types'

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI

export function isIdentityTransform(tr: Transform): boolean {
  const { position: p, rotationDeg: r, scale: s } = tr
  return (
    p[0] === 0 &&
    p[1] === 0 &&
    p[2] === 0 &&
    r[0] === 0 &&
    r[1] === 0 &&
    r[2] === 0 &&
    s[0] === 1 &&
    s[1] === 1 &&
    s[2] === 1
  )
}

export function rotationDegToRadians(rotationDeg: Vec3): Vec3 {
  return [rotationDeg[0] * DEG2RAD, rotationDeg[1] * DEG2RAD, rotationDeg[2] * DEG2RAD]
}

export function transformToMatrix4(tr: Transform): THREE.Matrix4 {
  const euler = new THREE.Euler(
    tr.rotationDeg[0] * DEG2RAD,
    tr.rotationDeg[1] * DEG2RAD,
    tr.rotationDeg[2] * DEG2RAD,
    'XYZ',
  )
  const quaternion = new THREE.Quaternion().setFromEuler(euler)
  return new THREE.Matrix4().compose(
    new THREE.Vector3(tr.position[0], tr.position[1], tr.position[2]),
    quaternion,
    new THREE.Vector3(tr.scale[0], tr.scale[1], tr.scale[2]),
  )
}

/** Column-major 16-element matrix for Manifold's `transform()` (last row ignored). */
export function transformToMat4Array(tr: Transform): number[] {
  return Array.from(transformToMatrix4(tr).elements)
}

// --- Pattern / mirror instance matrices (column-major, for Manifold) ---------
// These build the per-instance placement matrices the pattern engine applies to
// a source solid. Kept here because they are the same kind of TRS/affine math
// the rest of this module owns, and they need three.js to compose cleanly.

/** A pure translation by `v` (mm). */
export function translationMatrix(v: Vec3): number[] {
  return Array.from(new THREE.Matrix4().makeTranslation(v[0], v[1], v[2]).elements)
}

/** Rotation by `angleDeg` about the axis line through `origin` along `axisDir`. */
export function axisRotationMatrix(origin: Vec3, axisDir: Vec3, angleDeg: number): number[] {
  const axis = new THREE.Vector3(axisDir[0], axisDir[1], axisDir[2])
  if (axis.lengthSq() < 1e-12) axis.set(0, 0, 1)
  axis.normalize()
  const m = new THREE.Matrix4()
    .makeTranslation(origin[0], origin[1], origin[2])
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angleDeg * DEG2RAD))
    .multiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]))
  return Array.from(m.elements)
}

/**
 * Reflection across the plane through `origin` with unit `normal`. Manifold's
 * `transform` accepts this negative-determinant matrix and flips winding to keep
 * the result a valid solid. A degenerate (zero-length) normal yields identity.
 */
export function planeReflectionMatrix(origin: Vec3, normal: Vec3): number[] {
  const n = new THREE.Vector3(normal[0], normal[1], normal[2])
  if (n.lengthSq() < 1e-12) return Array.from(new THREE.Matrix4().elements)
  n.normalize()
  const { x, y, z } = n
  // Householder reflection I − 2·n·nᵀ (set() takes row-major args).
  const reflect = new THREE.Matrix4().set(
    1 - 2 * x * x,
    -2 * x * y,
    -2 * x * z,
    0,
    -2 * x * y,
    1 - 2 * y * y,
    -2 * y * z,
    0,
    -2 * x * z,
    -2 * y * z,
    1 - 2 * z * z,
    0,
    0,
    0,
    0,
    1,
  )
  const m = new THREE.Matrix4()
    .makeTranslation(origin[0], origin[1], origin[2])
    .multiply(reflect)
    .multiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]))
  return Array.from(m.elements)
}

export function matrix4ToTransform(m: THREE.Matrix4): Transform {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  m.decompose(position, quaternion, scale)
  return quaternionToTransform(position, quaternion, scale)
}

/** Read a three.js object's local TRS into a document Transform. */
export function objectToTransform(object: THREE.Object3D): Transform {
  return quaternionToTransform(object.position, object.quaternion, object.scale)
}

function quaternionToTransform(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3,
): Transform {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ')
  return {
    position: [position.x, position.y, position.z],
    rotationDeg: [euler.x * RAD2DEG, euler.y * RAD2DEG, euler.z * RAD2DEG],
    scale: [scale.x, scale.y, scale.z],
  }
}

export { IDENTITY_TRANSFORM }
