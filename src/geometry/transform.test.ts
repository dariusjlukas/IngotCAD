import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  DEG2RAD,
  isIdentityTransform,
  matrix4ToTransform,
  transformToMat4Array,
  transformToMatrix4,
} from './transform'
import { IDENTITY_TRANSFORM } from '../document/types'
import type { Transform, Vec3 } from '../document/types'

function quat(rotationDeg: Vec3): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotationDeg[0] * DEG2RAD, rotationDeg[1] * DEG2RAD, rotationDeg[2] * DEG2RAD, 'XYZ'),
  )
}

describe('transform', () => {
  it('detects the identity transform', () => {
    expect(isIdentityTransform(IDENTITY_TRANSFORM)).toBe(true)
    expect(isIdentityTransform({ ...IDENTITY_TRANSFORM, position: [1, 0, 0] })).toBe(false)
    expect(isIdentityTransform({ ...IDENTITY_TRANSFORM, scale: [1, 1, 2] })).toBe(false)
  })

  it('round-trips a transform through a matrix', () => {
    const t: Transform = { position: [3, -4, 5], rotationDeg: [30, 45, -60], scale: [2, 1, 0.5] }
    const back = matrix4ToTransform(transformToMatrix4(t))

    back.position.forEach((v, i) => expect(v).toBeCloseTo(t.position[i], 4))
    back.scale.forEach((v, i) => expect(v).toBeCloseTo(t.scale[i], 4))
    // Compare orientations via quaternion dot (Euler triples are not unique).
    expect(Math.abs(quat(t.rotationDeg).dot(quat(back.rotationDeg)))).toBeCloseTo(1, 4)
  })

  it('produces a column-major matrix with translation in slots 12-14', () => {
    const arr = transformToMat4Array({ position: [7, 8, 9], rotationDeg: [0, 0, 0], scale: [1, 1, 1] })
    expect(arr).toHaveLength(16)
    expect(arr[12]).toBeCloseTo(7)
    expect(arr[13]).toBeCloseTo(8)
    expect(arr[14]).toBeCloseTo(9)
  })
})
