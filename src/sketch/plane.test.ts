import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import {
  cardinalPlane,
  localToWorldMatrix,
  planeFromFace,
  planeToNodeTransform,
  resolvePlaneDefinition,
} from './plane'
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

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const crossV = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** Every resolved plane must be a right-handed orthonormal frame (n = u × v). */
function expectOrthonormal(p: SketchPlane) {
  expect(dot(p.u, p.u)).toBeCloseTo(1, 6)
  expect(dot(p.v, p.v)).toBeCloseTo(1, 6)
  expect(dot(p.n, p.n)).toBeCloseTo(1, 6)
  expect(dot(p.u, p.v)).toBeCloseTo(0, 6)
  expect(dot(p.u, p.n)).toBeCloseTo(0, 6)
  expect(dot(p.v, p.n)).toBeCloseTo(0, 6)
  close(crossV(p.u, p.v), p.n)
}

describe('resolvePlaneDefinition', () => {
  it('offset from a cardinal plane shifts the origin along the normal', () => {
    const p = resolvePlaneDefinition({ kind: 'offset', base: 'xy', distance: 10 })
    expect(p.origin).toEqual([0, 0, 10])
    expect(p.n).toEqual([0, 0, 1])
    expectOrthonormal(p)
  })

  it('offset from a picked face offsets along the face normal', () => {
    const p = resolvePlaneDefinition({
      kind: 'face',
      origin: [5, 5, 5],
      normal: [0, 0, 1],
      distance: 2,
    })
    expect(p.origin[2]).toBeCloseTo(7, 6)
    expect(p.n[2]).toBeCloseTo(1, 6)
    expectOrthonormal(p)
  })

  it('through three points spans the plane they lie in', () => {
    const p = resolvePlaneDefinition({
      kind: 'threePoints',
      a: [0, 0, 5],
      b: [10, 0, 5],
      c: [0, 10, 5],
    })
    expect(p.origin).toEqual([0, 0, 5])
    expect(p.n[2]).toBeCloseTo(1, 6) // points on z=5 → normal +Z
    expect(p.u).toEqual([1, 0, 0]) // a→b is +X
    expectOrthonormal(p)
  })

  it('angle about an edge hinges the reference normal around the axis', () => {
    const p = resolvePlaneDefinition({
      kind: 'edgeAngle',
      origin: [0, 0, 0],
      axis: [1, 0, 0],
      refNormal: [0, 0, 1],
      angleDeg: 90,
    })
    // +Z rotated +90° about +X → −Y; the axis stays in-plane as U.
    close(p.n, [0, -1, 0])
    expect(p.u).toEqual([1, 0, 0])
    expectOrthonormal(p)
  })

  it('angle 0 about an edge reproduces the reference plane', () => {
    const p = resolvePlaneDefinition({
      kind: 'edgeAngle',
      origin: [1, 2, 3],
      axis: [1, 0, 0],
      refNormal: [0, 0, 1],
      angleDeg: 0,
    })
    expect(p.n[2]).toBeCloseTo(1, 6)
    expect(p.origin).toEqual([1, 2, 3])
    expectOrthonormal(p)
  })

  it('three points collinear along Z still yield an orthonormal basis', () => {
    // Regression: the fallback normal is +Z here, and a→b is ALSO +Z, so the
    // re-orthogonalization used to zero out U and return a singular basis.
    const p = resolvePlaneDefinition({
      kind: 'threePoints',
      a: [0, 0, 0],
      b: [0, 0, 10],
      c: [0, 0, 20],
    })
    expectOrthonormal(p)
  })

  it('three identical points still yield an orthonormal basis', () => {
    const p = resolvePlaneDefinition({
      kind: 'threePoints',
      a: [3, 3, 3],
      b: [3, 3, 3],
      c: [3, 3, 3],
    })
    expectOrthonormal(p)
  })
})
