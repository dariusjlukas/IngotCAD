import { describe, it, expect } from 'vitest'
import { solve } from './solver'
import type { Constraint, SketchData, SPoint } from './model'

const P = (x: number, y: number, fixed = false): SPoint => ({ x, y, fixed })
const dist = (a: SPoint, b: SPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function data(points: Record<string, SPoint>, constraints: Constraint[]): SketchData {
  return { points, shapes: [], constraints }
}

describe('constraint solver', () => {
  it('satisfies a distance constraint', () => {
    const d = data({ a: P(0, 0), b: P(10, 0) }, [{ id: 'c', kind: 'distance', a: 'a', b: 'b', value: 50 }])
    solve(d)
    expect(dist(d.points.a, d.points.b)).toBeCloseTo(50, 1)
  })

  it('keeps a fixed point pinned', () => {
    const d = data({ a: P(0, 0, true), b: P(10, 0) }, [
      { id: 'c', kind: 'distance', a: 'a', b: 'b', value: 50 },
    ])
    solve(d)
    expect(d.points.a).toEqual({ x: 0, y: 0, fixed: true })
    expect(dist(d.points.a, d.points.b)).toBeCloseTo(50, 1)
  })

  it('respects a temporarily pinned (dragged) point', () => {
    const d = data({ a: P(0, 0), b: P(10, 0) }, [{ id: 'c', kind: 'distance', a: 'a', b: 'b', value: 30 }])
    solve(d, new Set(['a']))
    expect(d.points.a).toEqual({ x: 0, y: 0, fixed: false })
    expect(dist(d.points.a, d.points.b)).toBeCloseTo(30, 1)
  })

  it('makes a segment horizontal / vertical', () => {
    const h = data({ a: P(0, 0), b: P(10, 6) }, [{ id: 'c', kind: 'horizontal', a: 'a', b: 'b' }])
    solve(h)
    expect(h.points.a.y).toBeCloseTo(h.points.b.y, 4)

    const v = data({ a: P(0, 0), b: P(6, 10) }, [{ id: 'c', kind: 'vertical', a: 'a', b: 'b' }])
    solve(v)
    expect(v.points.a.x).toBeCloseTo(v.points.b.x, 4)
  })

  it('merges coincident points', () => {
    const d = data({ a: P(0, 0), b: P(10, 10) }, [{ id: 'c', kind: 'coincident', a: 'a', b: 'b' }])
    solve(d)
    expect(dist(d.points.a, d.points.b)).toBeLessThan(0.01)
  })

  it('equalizes two segment lengths', () => {
    const d = data({ a: P(0, 0, true), b: P(10, 0), c: P(0, 20, true), e: P(0, 50) }, [
      { id: 'c1', kind: 'equal', a: 'a', b: 'b', c: 'c', d: 'e' },
    ])
    solve(d)
    expect(dist(d.points.a, d.points.b)).toBeCloseTo(dist(d.points.c, d.points.e), 1)
  })

  it('makes a free segment parallel to a fixed horizontal one', () => {
    const d = data({ a: P(0, 0, true), b: P(10, 0, true), c: P(0, 10), e: P(10, 20) }, [
      { id: 'c1', kind: 'parallel', a: 'a', b: 'b', c: 'c', d: 'e' },
    ])
    solve(d)
    expect(Math.abs(d.points.c.y - d.points.e.y)).toBeLessThan(0.5)
  })

  it('makes a free segment perpendicular to a fixed horizontal one', () => {
    const d = data({ a: P(0, 0, true), b: P(10, 0, true), c: P(0, 10), e: P(10, 20) }, [
      { id: 'c1', kind: 'perpendicular', a: 'a', b: 'b', c: 'c', d: 'e' },
    ])
    solve(d)
    expect(Math.abs(d.points.c.x - d.points.e.x)).toBeLessThan(0.5)
  })

  it('solves a constrained rectangle to given width/height', () => {
    const d = data(
      { p0: P(0, 0, true), p1: P(10, 0), p2: P(10, 5), p3: P(0, 5) },
      [
        { id: 'h1', kind: 'horizontal', a: 'p0', b: 'p1' },
        { id: 'h2', kind: 'horizontal', a: 'p3', b: 'p2' },
        { id: 'v1', kind: 'vertical', a: 'p0', b: 'p3' },
        { id: 'v2', kind: 'vertical', a: 'p1', b: 'p2' },
        { id: 'dw', kind: 'distance', a: 'p0', b: 'p1', value: 40 },
        { id: 'dh', kind: 'distance', a: 'p0', b: 'p3', value: 20 },
      ],
    )
    solve(d)
    expect(d.points.p1.x).toBeCloseTo(40, 0)
    expect(d.points.p1.y).toBeCloseTo(0, 0)
    expect(d.points.p3.x).toBeCloseTo(0, 0)
    expect(d.points.p3.y).toBeCloseTo(20, 0)
    expect(d.points.p2.x).toBeCloseTo(40, 0)
    expect(d.points.p2.y).toBeCloseTo(20, 0)
  })
})
