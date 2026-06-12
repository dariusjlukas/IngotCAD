/** Arc geometry, arc-aware contours, and the new solver constraints. */
import { describe, expect, it } from 'vitest'
import { arcFromSagitta, arcPoints, distToArc, signedArea } from './geometry'
import {
  arcOfSegment,
  arcRadius,
  canTreatCorner,
  constraintPoints,
  loopOutline,
  removeShapeFromData,
  shapeContours,
} from './model'
import type { SketchData, SPoint } from './model'
import { solve } from './solver'
import type { Vec2 } from '../document/types'

const P = (x: number, y: number, fixed = false): SPoint => ({ x, y, fixed })
const dist = (a: SPoint, b: SPoint) => Math.hypot(a.x - b.x, a.y - b.y)

describe('arc geometry', () => {
  it('arcFromSagitta of a semicircle centers on the chord', () => {
    const res = arcFromSagitta([0, 0], [10, 0], 5)!
    expect(res.center[0]).toBeCloseTo(5)
    expect(res.center[1]).toBeCloseTo(0)
    // An upward (left-of-chord) bulge runs clockwise from start to end.
    expect(res.ccw).toBe(false)
  })

  it('arcFromSagitta flips side and sweep with the sagitta sign', () => {
    const res = arcFromSagitta([0, 0], [10, 0], -5)!
    expect(res.center[1]).toBeCloseTo(0)
    expect(res.ccw).toBe(true)
  })

  it('arcFromSagitta of a shallow arc puts the center opposite the bulge', () => {
    const res = arcFromSagitta([0, 0], [10, 0], 1)!
    // r = (25 + 1) / 2 = 13; center at (5, 1 - 13) = (5, -12)
    expect(res.center[0]).toBeCloseTo(5)
    expect(res.center[1]).toBeCloseTo(-12)
  })

  it('arcFromSagitta rejects degenerate input', () => {
    expect(arcFromSagitta([0, 0], [10, 0], 0)).toBeNull()
    expect(arcFromSagitta([3, 3], [3, 3], 2)).toBeNull()
  })

  it('arcPoints lie on the circle and split the sweep evenly', () => {
    const pts = arcPoints([5, 0], [0, 0], [10, 0], false) // upper semicircle, cw
    expect(pts.length).toBeGreaterThanOrEqual(16)
    for (const p of pts) {
      expect(Math.hypot(p[0] - 5, p[1])).toBeCloseTo(5, 6)
      expect(p[1]).toBeGreaterThan(0) // cw from (0,0) → over the top
    }
  })

  it('distToArc clamps to the angular span', () => {
    // Upper semicircle around (0,0), r=5, from (-5,0) cw to (5,0).
    const c: Vec2 = [0, 0]
    const a: Vec2 = [-5, 0]
    const b: Vec2 = [5, 0]
    // Radially outside the top of the arc:
    expect(distToArc([0, 7], c, a, b, false)).toBeCloseTo(2)
    // Below the chord (outside the span): nearest endpoint.
    expect(distToArc([0, -5], c, a, b, false)).toBeCloseTo(Math.hypot(5, 5))
  })
})

/** A 20×10 rectangle whose two short ends bulge outward as semicircles (a slot). */
function slotSketch(): SketchData {
  return {
    points: {
      a: P(0, 0),
      b: P(20, 0),
      c: P(20, 10),
      d: P(0, 10),
      // semicircle centers: middle of each short edge
      cr: P(20, 5),
      cl: P(0, 5),
    },
    shapes: [
      {
        id: 'loop',
        kind: 'loop',
        pts: ['a', 'b', 'c', 'd'],
        // Outward bulges: right of chord b→c (+x) and right of chord d→a (−x),
        // both counter-clockwise sweeps (pinned by the area test below).
        arcs: {
          b: { center: 'cr', ccw: true },
          d: { center: 'cl', ccw: true },
        },
      },
    ],
    constraints: [],
  }
}

describe('arc contours', () => {
  it('loopOutline expands arc segments into facets', () => {
    const data = slotSketch()
    const outline = loopOutline(data, data.shapes[0] as never)
    expect(outline.length).toBeGreaterThan(4 + 2 * 15)
  })

  it('a slot contour has rectangle + circle area', () => {
    const data = slotSketch()
    const contours = shapeContours(data)
    expect(contours).toHaveLength(1)
    // 20×10 rectangle + two semicircles of r=5 (= one full circle), minus a
    // small faceting deficit.
    const area = Math.abs(signedArea(contours[0]))
    const exact = 200 + Math.PI * 25
    expect(area).toBeGreaterThan(exact * 0.99)
    expect(area).toBeLessThanOrEqual(exact)
  })

  it('arcOfSegment finds the arc in either point order; arcRadius derives r', () => {
    const data = slotSketch()
    const f1 = arcOfSegment(data, 'b', 'c')!
    const f2 = arcOfSegment(data, 'c', 'b')!
    expect(f1.key).toBe('b')
    expect(f2.key).toBe('b')
    expect(arcOfSegment(data, 'a', 'b')).toBeNull()
    expect(arcRadius(data, f1.loop, 'b')).toBeCloseTo(5)
  })

  it('canTreatCorner refuses corners adjacent to an arc segment', () => {
    const data = slotSketch()
    expect(canTreatCorner(data, 'b')).toBe(false) // start of arc b→c
    expect(canTreatCorner(data, 'c')).toBe(false) // end of arc b→c
    // a and d are both endpoints of the d→a arc:
    expect(canTreatCorner(data, 'a')).toBe(false)
    expect(canTreatCorner(data, 'd')).toBe(false)
  })

  it('removeShapeFromData sweeps arc centers and their constraints', () => {
    const data = slotSketch()
    data.constraints.push({ id: 't', kind: 'radius', c: 'cr', a: 'b', b: 'c', value: 5 })
    removeShapeFromData(data, 'loop')
    expect(data.shapes).toHaveLength(0)
    expect(data.points.cr).toBeUndefined()
    expect(data.points.cl).toBeUndefined()
    expect(data.constraints).toHaveLength(0)
  })

  it('constraintPoints covers the new kinds', () => {
    expect(constraintPoints({ id: '1', kind: 'tangent', a: 'a', b: 'b', c: 'c' })).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(constraintPoints({ id: '1', kind: 'radius', c: 'c', a: 'a', b: 'b', value: 5 })).toEqual(
      ['c', 'a', 'b'],
    )
    expect(constraintPoints({ id: '1', kind: 'radius', c: 'c', shape: 's', value: 5 })).toEqual([
      'c',
    ])
    expect(
      constraintPoints({ id: '1', kind: 'angle', a: 'a', b: 'b', c: 'c', d: 'd', value: 45 }),
    ).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('solver: arcs and new constraints', () => {
  it('keeps the arc invariant |start−c| = |end−c| under solving', () => {
    const data: SketchData = {
      points: { a: P(0, 0), b: P(10, 0), x: P(10, 10), c: P(5, 7) },
      shapes: [
        { id: 'l', kind: 'loop', pts: ['a', 'b', 'x'], arcs: { a: { center: 'c', ccw: false } } },
      ],
      constraints: [],
    }
    // Center starts off-bisector (5,7): |a−c| ≈ 8.6, |b−c| ≈ 8.6 — perturb it.
    data.points.c = P(2, 7)
    solve(data)
    expect(dist(data.points.a, data.points.c)).toBeCloseTo(dist(data.points.b, data.points.c), 1)
  })

  it('radius constraint drives an arc to the target radius', () => {
    const data: SketchData = {
      points: { a: P(0, 0), b: P(10, 0), x: P(5, -10), c: P(5, 3, true) },
      shapes: [
        { id: 'l', kind: 'loop', pts: ['a', 'b', 'x'], arcs: { a: { center: 'c', ccw: false } } },
      ],
      constraints: [{ id: 'r', kind: 'radius', c: 'c', a: 'a', b: 'b', value: 8 }],
    }
    solve(data)
    expect(dist(data.points.a, data.points.c)).toBeCloseTo(8, 1)
    expect(dist(data.points.b, data.points.c)).toBeCloseTo(8, 1)
  })

  it('radius constraint sets a circle radius directly', () => {
    const data: SketchData = {
      points: { c: P(0, 0) },
      shapes: [{ id: 's', kind: 'circle', c: 'c', r: 3 }],
      constraints: [{ id: 'r', kind: 'radius', c: 'c', shape: 's', value: 7 }],
    }
    solve(data)
    const s = data.shapes[0]
    expect(s.kind === 'circle' && s.r).toBe(7)
  })

  it('tangent pulls a free line onto a fixed circle', () => {
    const data: SketchData = {
      points: { c: P(0, 0, true), a: P(-10, 8), b: P(10, 8) },
      shapes: [{ id: 's', kind: 'circle', c: 'c', r: 5 }],
      constraints: [{ id: 't', kind: 'tangent', a: 'a', b: 'b', c: 'c', shape: 's' }],
    }
    solve(data)
    // Perpendicular distance from the center to the line ≈ r.
    const { a, b, c } = data.points
    const L = Math.hypot(b.x - a.x, b.y - a.y)
    const d = Math.abs((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / L
    expect(d).toBeCloseTo(5, 1)
  })

  it('tangent moves a free circle center onto a fixed line', () => {
    const data: SketchData = {
      points: { c: P(0, 9), a: P(-10, 0, true), b: P(10, 0, true) },
      shapes: [{ id: 's', kind: 'circle', c: 'c', r: 5 }],
      constraints: [{ id: 't', kind: 'tangent', a: 'a', b: 'b', c: 'c', shape: 's' }],
    }
    solve(data)
    expect(Math.abs(data.points.c.y)).toBeCloseTo(5, 1)
  })

  it('angle constraint reaches 45° and 135° (directed, no mod-π fold)', () => {
    for (const target of [45, 135]) {
      const data: SketchData = {
        points: { a: P(0, 0, true), b: P(10, 0, true), c: P(0, 0, true), d: P(10, 1) },
        shapes: [],
        constraints: [{ id: 'g', kind: 'angle', a: 'a', b: 'b', c: 'c', d: 'd', value: target }],
      }
      solve(data)
      const { c, d } = data.points
      const deg = (Math.atan2(d.y - c.y, d.x - c.x) * 180) / Math.PI
      expect(((deg % 360) + 360) % 360).toBeCloseTo(target, 0)
    }
  })
})
