import { describe, it, expect } from 'vitest'
import {
  bboxCenter,
  cleanContours,
  cornerPoints,
  distance,
  ensureCCW,
  makeCircle,
  makeRectangle,
  maxCornerSize,
  niceStep,
  pointInPolygon,
  signedArea,
} from './geometry'
import type { Vec2 } from '../document/types'

describe('sketch geometry', () => {
  it('signedArea is positive for CCW, negative for CW', () => {
    const ccw: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    expect(signedArea(ccw)).toBeCloseTo(100)
    expect(signedArea([...ccw].reverse())).toBeCloseTo(-100)
  })

  it('ensureCCW flips clockwise polygons', () => {
    const cw: Vec2[] = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ]
    expect(signedArea(cw)).toBeLessThan(0)
    expect(signedArea(ensureCCW(cw))).toBeGreaterThan(0)
  })

  it('makeRectangle is CCW with correct extent regardless of drag direction', () => {
    const r = makeRectangle([10, 20], [0, 0])
    expect(signedArea(r)).toBeCloseTo(200)
    const xs = r.map((p) => p[0])
    const ys = r.map((p) => p[1])
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(10)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(20)
  })

  it('makeCircle has the requested segments and radius and is CCW', () => {
    const c = makeCircle([0, 0], 5, 32)
    expect(c).toHaveLength(32)
    for (const p of c) expect(distance([0, 0], p)).toBeCloseTo(5)
    expect(signedArea(c)).toBeGreaterThan(0)
  })

  it('bboxCenter returns the center of all contours', () => {
    expect(
      bboxCenter([
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ]),
    ).toEqual([5, 5])
  })

  it('cleanContours drops degenerate contours and normalizes winding', () => {
    const good: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const tooFew: Vec2[] = [
      [0, 0],
      [1, 1],
    ]
    const cleaned = cleanContours([good, tooFew])
    expect(cleaned).toHaveLength(1)
    expect(signedArea(cleaned[0])).toBeGreaterThan(0)
  })

  it('pointInPolygon detects inside vs outside', () => {
    const square: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    expect(pointInPolygon(square, [5, 5])).toBe(true)
    expect(pointInPolygon(square, [15, 5])).toBe(false)
    expect(pointInPolygon(square, [-1, 5])).toBe(false)
  })

  it('niceStep picks 1/2/5×10ⁿ steps for ~20 divisions', () => {
    expect(niceStep(240)).toBe(20)
    expect(niceStep(20)).toBe(1)
    expect(niceStep(2000)).toBe(100)
  })

  // A right-angle corner at the origin: previous neighbour along +X, next along +Y.
  const prev: Vec2 = [10, 0]
  const corner: Vec2 = [0, 0]
  const next: Vec2 = [0, 10]

  it('cornerPoints fillets a 90° corner into a tangent arc', () => {
    const arc = cornerPoints(prev, corner, next, 'fillet', 3)
    expect(arc.length).toBeGreaterThan(2)
    // Tangent points sit at the setback (r for a right angle) on each edge.
    expect(arc[0][0]).toBeCloseTo(3)
    expect(arc[0][1]).toBeCloseTo(0)
    expect(arc[arc.length - 1][0]).toBeCloseTo(0)
    expect(arc[arc.length - 1][1]).toBeCloseTo(3)
    // Every point lies on a circle of radius 3 centered on the bisector at (3,3).
    for (const p of arc) expect(distance([3, 3], p)).toBeCloseTo(3)
  })

  it('cornerPoints chamfers a 90° corner into two setback points', () => {
    expect(cornerPoints(prev, corner, next, 'chamfer', 3)).toEqual([
      [3, 0],
      [0, 3],
    ])
  })

  it('cornerPoints clamps an oversized treatment to half the shorter edge', () => {
    // Edges are length 10, so the per-edge setback caps at 5.
    expect(cornerPoints(prev, corner, next, 'chamfer', 100)).toEqual([
      [5, 0],
      [0, 5],
    ])
    const arc = cornerPoints(prev, corner, next, 'fillet', 100)
    expect(arc[0][0]).toBeCloseTo(5)
    expect(arc[arc.length - 1][1]).toBeCloseTo(5)
  })

  it('cornerPoints leaves a collinear (degenerate) corner unchanged', () => {
    expect(cornerPoints([10, 0], [0, 0], [-10, 0], 'fillet', 3)).toEqual([[0, 0]])
  })

  it('maxCornerSize caps fillet/chamfer at half the shorter edge', () => {
    expect(maxCornerSize(prev, corner, next, 'chamfer')).toBeCloseTo(5)
    // A right-angle fillet radius equals its setback, so the cap is also 5.
    expect(maxCornerSize(prev, corner, next, 'fillet')).toBeCloseTo(5)
  })
})
