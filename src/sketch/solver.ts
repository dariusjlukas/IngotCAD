/**
 * A tiny position-based (Gauss-Seidel relaxation) constraint solver.
 *
 * Each constraint is a *projection*: it nudges the points it involves toward
 * satisfaction. We sweep all constraints many times; positions converge. Fixed
 * (or temporarily pinned, e.g. the point being dragged) points have zero weight
 * and never move. This is intentionally simple and forgiving — over-constrained
 * sketches relax to a least-surprise compromise instead of failing, which suits
 * hobbyist use.
 */
import type { Constraint, PointId, SketchData, SPoint } from './model'

const POS_ITERATIONS = 160
const ROT_RELAX = 0.5 // rotational constraints converge gently to stay stable

export function solve(
  data: SketchData,
  pinned: Set<PointId> = new Set(),
  iterations = POS_ITERATIONS,
): void {
  const weight = (id: PointId): number => {
    const p = data.points[id]
    return !p || p.fixed || pinned.has(id) ? 0 : 1
  }
  for (let i = 0; i < iterations; i++) {
    for (const c of data.constraints) project(data, c, weight)
  }
}

type Weight = (id: PointId) => number

function project(data: SketchData, c: Constraint, w: Weight): void {
  const P = data.points
  switch (c.kind) {
    case 'coincident':
      coincident(P[c.a], P[c.b], w(c.a), w(c.b))
      break
    case 'horizontal':
      axisAlign(P[c.a], P[c.b], w(c.a), w(c.b), 'y')
      break
    case 'vertical':
      axisAlign(P[c.a], P[c.b], w(c.a), w(c.b), 'x')
      break
    case 'distance':
      distance(P[c.a], P[c.b], w(c.a), w(c.b), c.value)
      break
    case 'equal': {
      const l1 = len(P[c.a], P[c.b])
      const l2 = len(P[c.c], P[c.d])
      const target = (l1 + l2) / 2
      distance(P[c.a], P[c.b], w(c.a), w(c.b), target)
      distance(P[c.c], P[c.d], w(c.c), w(c.d), target)
      break
    }
    case 'parallel': {
      const t = lineMean(angle(P[c.a], P[c.b]), angle(P[c.c], P[c.d]))
      rotateToward(P[c.a], P[c.b], w(c.a), w(c.b), t)
      rotateToward(P[c.c], P[c.d], w(c.c), w(c.d), t)
      break
    }
    case 'perpendicular': {
      const base = lineMean(angle(P[c.a], P[c.b]), angle(P[c.c], P[c.d]) - Math.PI / 2)
      rotateToward(P[c.a], P[c.b], w(c.a), w(c.b), base)
      rotateToward(P[c.c], P[c.d], w(c.c), w(c.d), base + Math.PI / 2)
      break
    }
  }
}

function coincident(a: SPoint, b: SPoint, wa: number, wb: number): void {
  const sw = wa + wb
  if (!a || !b || sw === 0) return
  const dx = b.x - a.x
  const dy = b.y - a.y
  a.x += (dx * wa) / sw
  a.y += (dy * wa) / sw
  b.x -= (dx * wb) / sw
  b.y -= (dy * wb) / sw
}

function axisAlign(a: SPoint, b: SPoint, wa: number, wb: number, axis: 'x' | 'y'): void {
  const sw = wa + wb
  if (!a || !b || sw === 0) return
  const d = b[axis] - a[axis]
  a[axis] += (d * wa) / sw
  b[axis] -= (d * wb) / sw
}

function distance(a: SPoint, b: SPoint, wa: number, wb: number, target: number): void {
  const sw = wa + wb
  if (!a || !b || sw === 0) return
  let dx = b.x - a.x
  let dy = b.y - a.y
  let d = Math.hypot(dx, dy)
  if (d < 1e-9) {
    dx = 1
    dy = 0
    d = 0
  } else {
    dx /= d
    dy /= d
  }
  const err = d - target
  a.x += (dx * err * wa) / sw
  a.y += (dy * err * wa) / sw
  b.x -= (dx * err * wb) / sw
  b.y -= (dy * err * wb) / sw
}

function rotateToward(a: SPoint, b: SPoint, wa: number, wb: number, target: number): void {
  if (!a || !b || wa + wb === 0) return
  // smallest rotation that aligns the segment's *line* with `target`
  let da = Math.atan2(Math.sin(target - angle(a, b)), Math.cos(target - angle(a, b)))
  if (da > Math.PI / 2) da -= Math.PI
  else if (da < -Math.PI / 2) da += Math.PI
  da *= ROT_RELAX

  if (wa === 0) rotateAbout(b, a, da)
  else if (wb === 0) rotateAbout(a, b, da)
  else {
    const px = (a.x + b.x) / 2
    const py = (a.y + b.y) / 2
    rotateAbout(a, { x: px, y: py }, da)
    rotateAbout(b, { x: px, y: py }, da)
  }
}

function rotateAbout(p: SPoint, pivot: { x: number; y: number }, ang: number): void {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  p.x = pivot.x + dx * c - dy * s
  p.y = pivot.y + dx * s + dy * c
}

function len(a: SPoint, b: SPoint): number {
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
}

function angle(a: SPoint, b: SPoint): number {
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/** Circular mean of two angles treated as undirected lines (mod π). */
function lineMean(x: number, y: number): number {
  const s = Math.sin(2 * x) + Math.sin(2 * y)
  const c = Math.cos(2 * x) + Math.cos(2 * y)
  return Math.atan2(s, c) / 2
}
