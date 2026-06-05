import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { coplanarFacePositions } from './faceHighlight'

describe('coplanarFacePositions', () => {
  it('returns the two triangles of a box face', () => {
    const box = new THREE.BoxGeometry(10, 10, 10)
    const positions = coplanarFacePositions(box, 0)
    expect(positions).not.toBeNull()
    // 2 triangles × 3 verts × 3 coords
    expect(positions!.length).toBe(18)
  })

  it('all returned vertices lie on one plane', () => {
    const box = new THREE.BoxGeometry(10, 20, 30)
    const positions = coplanarFacePositions(box, 5)!
    // Plane from the first triangle.
    const a = new THREE.Vector3(positions[0], positions[1], positions[2])
    const b = new THREE.Vector3(positions[3], positions[4], positions[5])
    const c = new THREE.Vector3(positions[6], positions[7], positions[8])
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize()
    const off = normal.dot(a)
    for (let i = 0; i < positions.length; i += 3) {
      const p = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2])
      expect(normal.dot(p)).toBeCloseTo(off, 4)
    }
  })

  it('returns null for an out-of-range face index', () => {
    const box = new THREE.BoxGeometry(1, 1, 1)
    expect(coplanarFacePositions(box, 9999)).toBeNull()
  })
})
