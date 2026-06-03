import { describe, it, expect } from 'vitest'
import {
  bboxCenter,
  cleanContours,
  distance,
  ensureCCW,
  makeCircle,
  makeRectangle,
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
})
