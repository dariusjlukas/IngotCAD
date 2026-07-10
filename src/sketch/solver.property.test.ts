/**
 * Property-style hardening tests for the relaxation solver: randomized (but
 * seeded, fully deterministic) systems checking the invariants that matter —
 * convergence on satisfiable systems, fixed points never move, and no NaN
 * escapes from degenerate configurations.
 */
import { describe, it, expect } from 'vitest'
import { solve } from './solver'
import type { Constraint, SketchData, SPoint } from './model'

/** Deterministic PRNG (mulberry32) so failures reproduce exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const P = (x: number, y: number, fixed = false): SPoint => ({ x, y, fixed })
const dist = (a: SPoint, b: SPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function data(points: Record<string, SPoint>, constraints: Constraint[]): SketchData {
  return { points, shapes: [], constraints }
}

describe('solver properties', () => {
  it('converges on random distance chains (anchored at one end)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed)
      const n = 3 + Math.floor(r() * 3) // 3..5 links
      const points: Record<string, SPoint> = { p0: P(r() * 40 - 20, r() * 40 - 20, true) }
      const constraints: Constraint[] = []
      const targets: number[] = []
      for (let i = 1; i <= n; i++) {
        points[`p${i}`] = P(r() * 100 - 50, r() * 100 - 50)
        const target = 5 + r() * 55
        targets.push(target)
        constraints.push({
          id: `d${i}`,
          kind: 'distance',
          a: `p${i - 1}`,
          b: `p${i}`,
          value: target,
        })
      }
      const d = data(points, constraints)
      solve(d)
      for (let i = 1; i <= n; i++) {
        const got = dist(d.points[`p${i - 1}`], d.points[`p${i}`])
        expect(Math.abs(got - targets[i - 1]), `seed ${seed} link ${i}`).toBeLessThan(
          Math.max(0.5, targets[i - 1] * 0.01),
        )
      }
    }
  })

  it('solves rectangles of random dimensions', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed * 7919)
      const w = 5 + r() * 75
      const h = 5 + r() * 75
      // Start from a randomly skewed quad; constraints should square it up.
      const d = data(
        {
          p0: P(0, 0, true),
          p1: P(10 + r() * 10, r() * 6 - 3),
          p2: P(10 + r() * 10, 5 + r() * 10),
          p3: P(r() * 6 - 3, 5 + r() * 10),
        },
        [
          { id: 'h1', kind: 'horizontal', a: 'p0', b: 'p1' },
          { id: 'h2', kind: 'horizontal', a: 'p3', b: 'p2' },
          { id: 'v1', kind: 'vertical', a: 'p0', b: 'p3' },
          { id: 'v2', kind: 'vertical', a: 'p1', b: 'p2' },
          { id: 'dw', kind: 'distance', a: 'p0', b: 'p1', value: w },
          { id: 'dh', kind: 'distance', a: 'p0', b: 'p3', value: h },
        ],
      )
      solve(d)
      expect(Math.abs(d.points.p1.x - w), `seed ${seed} width`).toBeLessThan(0.5)
      expect(Math.abs(d.points.p3.y - h), `seed ${seed} height`).toBeLessThan(0.5)
      expect(Math.abs(d.points.p2.x - w), `seed ${seed} p2.x`).toBeLessThan(0.5)
      expect(Math.abs(d.points.p2.y - h), `seed ${seed} p2.y`).toBeLessThan(0.5)
    }
  })

  it('never moves fixed points, even in contradictory systems', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed * 104729)
      const points: Record<string, SPoint> = {}
      const ids: string[] = []
      for (let i = 0; i < 6; i++) {
        const id = `p${i}`
        ids.push(id)
        points[id] = P(r() * 100 - 50, r() * 100 - 50, r() < 0.4)
      }
      const pickId = () => ids[Math.floor(r() * ids.length)]
      const constraints: Constraint[] = []
      // A deliberately over-constrained soup: contradictions are expected and
      // must relax to a compromise without disturbing any anchored point.
      for (let i = 0; i < 10; i++) {
        const kinds = ['distance', 'horizontal', 'vertical', 'coincident', 'parallel'] as const
        const kind = kinds[Math.floor(r() * kinds.length)]
        if (kind === 'distance') {
          constraints.push({ id: `c${i}`, kind, a: pickId(), b: pickId(), value: 1 + r() * 50 })
        } else if (kind === 'parallel') {
          constraints.push({
            id: `c${i}`,
            kind,
            a: pickId(),
            b: pickId(),
            c: pickId(),
            d: pickId(),
          })
        } else {
          constraints.push({ id: `c${i}`, kind, a: pickId(), b: pickId() })
        }
      }
      const d = data(points, constraints)
      const before = Object.fromEntries(
        Object.entries(d.points)
          .filter(([, p]) => p.fixed)
          .map(([id, p]) => [id, { x: p.x, y: p.y }]),
      )
      solve(d)
      for (const [id, snap] of Object.entries(before)) {
        expect(d.points[id].x, `seed ${seed} ${id}.x`).toBe(snap.x)
        expect(d.points[id].y, `seed ${seed} ${id}.y`).toBe(snap.y)
      }
    }
  })

  it('produces no NaN from degenerate configurations', () => {
    // Every constraint kind aimed at coincident / zero-length geometry: the
    // solver may not fully satisfy these (they are singular) but must stay
    // finite — one NaN would poison every later sweep via 0 * NaN.
    const d: SketchData = {
      points: {
        a: P(5, 5),
        b: P(5, 5), // zero-length segment a–b
        c: P(5, 5), // and a center right on top of it
        e: P(20, 20, true),
        f: P(20, 20), // zero-length with one end fixed
      },
      shapes: [{ id: 'circ', kind: 'circle', c: 'c', r: 8 }],
      constraints: [
        { id: 'c1', kind: 'distance', a: 'a', b: 'b', value: 10 },
        { id: 'c2', kind: 'coincident', a: 'a', b: 'b' },
        { id: 'c3', kind: 'horizontal', a: 'a', b: 'b' },
        { id: 'c4', kind: 'vertical', a: 'e', b: 'f' },
        { id: 'c5', kind: 'parallel', a: 'a', b: 'b', c: 'e', d: 'f' },
        { id: 'c6', kind: 'perpendicular', a: 'a', b: 'b', c: 'e', d: 'f' },
        { id: 'c7', kind: 'equal', a: 'a', b: 'b', c: 'e', d: 'f' },
        { id: 'c8', kind: 'tangent', a: 'a', b: 'b', c: 'c', shape: 'circ' },
        { id: 'c9', kind: 'radius', c: 'c', a: 'a', b: 'b', value: 12 },
        { id: 'c10', kind: 'angle', a: 'a', b: 'b', c: 'e', d: 'f', value: 45 },
      ],
    }
    solve(d)
    for (const [id, p] of Object.entries(d.points)) {
      expect(Number.isFinite(p.x), `${id}.x finite`).toBe(true)
      expect(Number.isFinite(p.y), `${id}.y finite`).toBe(true)
    }
  })

  it('is stable once converged (a second solve barely moves anything)', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = rng(seed * 31337)
      const d = data(
        {
          p0: P(0, 0, true),
          p1: P(r() * 60, r() * 60),
          p2: P(r() * 60, r() * 60),
          p3: P(r() * 60, r() * 60),
        },
        [
          { id: 'd1', kind: 'distance', a: 'p0', b: 'p1', value: 30 },
          { id: 'd2', kind: 'distance', a: 'p1', b: 'p2', value: 20 },
          { id: 'd3', kind: 'distance', a: 'p2', b: 'p3', value: 25 },
          { id: 'h1', kind: 'horizontal', a: 'p0', b: 'p1' },
        ],
      )
      solve(d)
      const snap = Object.fromEntries(
        Object.entries(d.points).map(([id, p]) => [id, { x: p.x, y: p.y }]),
      )
      solve(d)
      for (const [id, p] of Object.entries(d.points)) {
        const moved = Math.hypot(p.x - snap[id].x, p.y - snap[id].y)
        expect(moved, `seed ${seed} ${id} drift`).toBeLessThan(0.05)
      }
    }
  })
})
