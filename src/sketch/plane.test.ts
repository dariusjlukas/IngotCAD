import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { cardinalPlane, localToWorldMatrix, planeFromFace, planeToNodeTransform } from './plane'
import type { SketchPlane } from './plane'
import type { Vec3 } from '../document/types'

function mapLocal(plane: SketchPlane, local: Vec3): Vec3 {
  const m = new THREE.Matrix4().fromArray(localToWorldMatrix(plane))
  const p = new THREE.Vector3(...local).applyMatrix4(m)
  return [p.x, p.y, p.z]
}

const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5))

describe('sketch plane', () => {
  it('XY plane maps local axes to world X/Y/Z', () => {
    const p = cardinalPlane('xy')
    close(mapLocal(p, [1, 0, 0]), [1, 0, 0])
    close(mapLocal(p, [0, 1, 0]), [0, 1, 0])
    close(mapLocal(p, [0, 0, 1]), [0, 0, 1])
  })

  it('XZ plane maps local Y to world Z and normal to -Y', () => {
    const p = cardinalPlane('xz')
    close(mapLocal(p, [1, 0, 0]), [1, 0, 0]) // local x → world X
    close(mapLocal(p, [0, 1, 0]), [0, 0, 1]) // local y → world Z
    close(mapLocal(p, [0, 0, 1]), [0, -1, 0]) // normal → world -Y
  })

  it('YZ plane maps local axes to world Y/Z with normal +X', () => {
    const p = cardinalPlane('yz')
    close(mapLocal(p, [1, 0, 0]), [0, 1, 0])
    close(mapLocal(p, [0, 1, 0]), [0, 0, 1])
    close(mapLocal(p, [0, 0, 1]), [1, 0, 0])
  })

  it('planeFromFace yields an orthonormal right-handed frame at the point', () => {
    const p = planeFromFace([3, 4, 5], [0, 0, 2])
    expect(p.origin).toEqual([3, 4, 5])
    const u = new THREE.Vector3(...p.u)
    const v = new THREE.Vector3(...p.v)
    const n = new THREE.Vector3(...p.n)
    expect(u.length()).toBeCloseTo(1)
    expect(v.length()).toBeCloseTo(1)
    expect(n.length()).toBeCloseTo(1)
    expect(u.dot(n)).toBeCloseTo(0)
    expect(v.dot(n)).toBeCloseTo(0)
    // u × v === n  (right-handed)
    const cross = new THREE.Vector3().crossVectors(u, v)
    close([cross.x, cross.y, cross.z], p.n)
  })

  it('planeToNodeTransform on XY is a pure in-plane translation', () => {
    const t = planeToNodeTransform(cardinalPlane('xy'), 12, -7)
    close(t.position, [12, -7, 0])
    t.rotationDeg.forEach((d) => expect(Math.abs(d)).toBeCloseTo(0))
    close(t.scale, [1, 1, 1])
  })
})
