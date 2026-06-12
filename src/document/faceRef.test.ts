import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { composeFaceWorld, matchFaceRef, worldMatrixOf, worldPlanesAgree } from './faceRef'
import { createEmptyDocument, IDENTITY_TRANSFORM } from './types'
import type { FaceRef, Vec3 } from './types'
import type { PlanarFaceGroup } from '../geometry/edges'

const g = (normal: Vec3, offset: number, area = 100): PlanarFaceGroup => ({
  normal,
  offset,
  area,
  centroid: [normal[0] * offset, normal[1] * offset, normal[2] * offset],
})

const ref = (normal: Vec3, offset: number): FaceRef => ({ nodeId: 'src', normal, offset })

describe('matchFaceRef', () => {
  it('exact match when the face is unchanged', () => {
    const r = matchFaceRef(ref([0, 0, 1], 10), [g([0, 0, 1], 10), g([0, 0, -1], 0)])
    expect(r.status).toBe('ok')
  })

  it('moved when the face shifted along its normal', () => {
    const r = matchFaceRef(ref([0, 0, 1], 10), [g([0, 0, 1], 13)])
    expect(r.status).toBe('moved')
    if (r.status === 'moved') expect(r.local.offset).toBe(13)
  })

  it('missing when the face is gone', () => {
    const r = matchFaceRef(ref([0, 0, 1], 10), [g([1, 0, 0], 10), g([0, 1, 0], 10)])
    expect(r.status).toBe('missing')
  })

  it('ambiguous candidates resolve to missing, never a guess', () => {
    const r = matchFaceRef(ref([0, 0, 1], 10), [g([0, 0, 1], 12), g([0, 0, 1], 8.1)])
    expect(r.status).toBe('missing')
  })
})

describe('composeFaceWorld', () => {
  it('passes a plane through an identity transform', () => {
    const w = composeFaceWorld(new THREE.Matrix4(), { normal: [0, 0, 1], offset: 5 })
    expect(w.normal[2]).toBeCloseTo(1)
    expect(w.point[2]).toBeCloseTo(5)
  })

  it('handles rotation + non-uniform scale (inverse-transpose normals)', () => {
    // Scale x by 2, rotate 90° about z: local +x face at x=10 should land on +y.
    const m = new THREE.Matrix4()
      .makeRotationZ(Math.PI / 2)
      .multiply(new THREE.Matrix4().makeScale(2, 1, 1))
    const w = composeFaceWorld(m, { normal: [1, 0, 0], offset: 10 })
    expect(w.normal[0]).toBeCloseTo(0)
    expect(w.normal[1]).toBeCloseTo(1)
    expect(w.point[1]).toBeCloseTo(20) // 10mm scaled ×2, rotated onto +y
    expect(worldPlanesAgree(w, { normal: [0, 1, 0], origin: [3, 20, -7] })).toBe(true)
    expect(worldPlanesAgree(w, { normal: [0, 1, 0], origin: [0, 19, 0] })).toBe(false)
  })
})

describe('worldMatrixOf', () => {
  it('composes the ancestor chain', () => {
    const doc = createEmptyDocument()
    doc.nodes.child = {
      id: 'child',
      kind: 'primitive',
      name: 'c',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM, position: [1, 0, 0] },
      params: { type: 'box', size: [1, 1, 1] },
    }
    doc.nodes.parent = {
      id: 'parent',
      kind: 'group',
      name: 'g',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM, position: [0, 2, 0] },
      childIds: ['child'],
    }
    doc.rootIds = ['parent']
    const m = worldMatrixOf(doc, 'child')!
    const p = new THREE.Vector3(0, 0, 0).applyMatrix4(m)
    expect([p.x, p.y, p.z]).toEqual([1, 2, 0])
    expect(worldMatrixOf(doc, 'nope')).toBeNull()
  })
})
