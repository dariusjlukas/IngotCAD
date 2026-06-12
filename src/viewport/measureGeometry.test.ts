import { describe, expect, it } from 'vitest'
import { entityInfo, faceArea, measurePair } from './measureGeometry'
import type { MeasureEntity } from './measureGeometry'

const vert = (x: number, y: number, z: number): MeasureEntity => ({
  kind: 'vertex',
  point: [x, y, z],
})

describe('measurePair', () => {
  it('vertex ↔ vertex: distance with axis deltas', () => {
    const r = measurePair(vert(0, 0, 0), vert(3, 4, 0))
    expect(r.type).toBe('distance')
    if (r.type === 'distance') {
      expect(r.value).toBeCloseTo(5)
      expect(r.delta).toEqual([3, 4, 0])
    }
  })

  it('vertex ↔ face: perpendicular distance to the plane', () => {
    const face: MeasureEntity = { kind: 'face', point: [0, 0, 10], normal: [0, 0, 1], area: 100 }
    const r = measurePair(vert(5, 5, 4), face)
    expect(r.type === 'distance' && r.value).toBeCloseTo(6)
  })

  it('parallel faces: plane distance; skew faces: angle', () => {
    const f1: MeasureEntity = { kind: 'face', point: [0, 0, 0], normal: [0, 0, 1], area: 1 }
    const f2: MeasureEntity = { kind: 'face', point: [9, 9, 7], normal: [0, 0, -1], area: 1 }
    const r = measurePair(f1, f2)
    expect(r.type === 'distance' && r.value).toBeCloseTo(7)
    const f3: MeasureEntity = { kind: 'face', point: [0, 0, 0], normal: [1, 0, 0], area: 1 }
    const r2 = measurePair(f1, f3)
    expect(r2.type === 'angle' && r2.valueDeg).toBeCloseTo(90)
  })

  it('circles pair as their centers (hole spacing)', () => {
    const c1: MeasureEntity = {
      kind: 'circle',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 3,
      arc: false,
    }
    const c2: MeasureEntity = {
      kind: 'circle',
      center: [20, 0, 0],
      axis: [0, 0, 1],
      radius: 5,
      arc: false,
    }
    const r = measurePair(c1, c2)
    expect(r.type === 'distance' && r.value).toBeCloseTo(20)
  })

  it('edge ↔ edge: minimum distance between segments', () => {
    const e1: MeasureEntity = { kind: 'edge', a: [0, 0, 0], b: [10, 0, 0] }
    const e2: MeasureEntity = { kind: 'edge', a: [0, 5, 3], b: [10, 5, 3] }
    const r = measurePair(e1, e2)
    expect(r.type === 'distance' && r.value).toBeCloseTo(Math.hypot(5, 3))
  })

  it('vertex ↔ edge: clamped to the segment', () => {
    const e: MeasureEntity = { kind: 'edge', a: [0, 0, 0], b: [10, 0, 0] }
    const r = measurePair(vert(20, 0, 0), e)
    expect(r.type === 'distance' && r.value).toBeCloseTo(10) // nearest endpoint
  })
})

describe('entityInfo / faceArea', () => {
  it('reports circle diameter', () => {
    const lines = entityInfo({
      kind: 'circle',
      center: [0, 0, 0],
      axis: [0, 0, 1],
      radius: 4,
      arc: false,
    })
    expect(lines[0]).toContain('8.000 mm')
  })

  it('faceArea of a unit-square soup', () => {
    // two triangles covering the unit square in z=0
    const soup = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0])
    expect(faceArea(soup)).toBeCloseTo(1)
  })
})
