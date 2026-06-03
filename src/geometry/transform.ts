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
