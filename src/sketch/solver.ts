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
    projectArcs(data, weight)
  }
}

/**
 * The implicit invariant of every loop arc: both endpoints sit at the same
 * distance from the center (|start−c| = |end−c|). Projected each sweep like a
 * built-in `equal` constraint, so dragging any of the three points "just works".
 */
function projectArcs(data: SketchData, w: Weight): void {
  for (const s of data.shapes) {
    if (s.kind !== 'loop' || !s.arcs) continue
    const n = s.pts.length
    for (const [startPid, arc] of Object.entries(s.arcs)) {
      const i = s.pts.indexOf(startPid)
      if (i < 0) continue
      const endPid = s.pts[(i + 1) % n]
      const a = data.points[startPid]
      const b = data.points[endPid]
      const c = data.points[arc.center]
      if (!a || !b || !c) continue
      const target = (len(a, c) + len(b, c)) / 2
      distance(a, c, w(startPid), w(arc.center), target)
      distance(b, c, w(endPid), w(arc.center), target)
    }
  }
}

type Weight = (id: PointId) => number

function project(data: SketchData, c: Constraint, w: Weight): void {
  const P = data.points
  // A non-finite target (e.g. Infinity from a hostile file) would NaN-poison
  // every point it touches within two sweeps — skip the constraint instead.
  if ('value' in c && !Number.isFinite(c.value)) return
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
      if (!P[c.a] || !P[c.b] || !P[c.c] || !P[c.d]) return
      const t = lineMean(angle(P[c.a], P[c.b]), angle(P[c.c], P[c.d]))
      rotateToward(P[c.a], P[c.b], w(c.a), w(c.b), t)
      rotateToward(P[c.c], P[c.d], w(c.c), w(c.d), t)
      break
    }
    case 'perpendicular': {
      if (!P[c.a] || !P[c.b] || !P[c.c] || !P[c.d]) return
      const base = lineMean(angle(P[c.a], P[c.b]), angle(P[c.c], P[c.d]) - Math.PI / 2)
      rotateToward(P[c.a], P[c.b], w(c.a), w(c.b), base)
      rotateToward(P[c.c], P[c.d], w(c.c), w(c.d), base + Math.PI / 2)
      break
    }
    case 'tangent': {
      const a = P[c.a]
      const b = P[c.b]
      const ctr = P[c.c]
      if (!a || !b || !ctr) return
      const r = tangentTargetRadius(data, c)
      if (r <= 0) return
      const dx = b.x - a.x
      const dy = b.y - a.y
      const L = Math.hypot(dx, dy)
      if (L < 1e-9) return
      // Unit normal of the line, flipped to point from the line TOWARD the center.
      let nx = -dy / L
      let ny = dx / L
      let d = (ctr.x - a.x) * nx + (ctr.y - a.y) * ny
      if (d < 0) {
        nx = -nx
        ny = -ny
        d = -d
      }
      const err = d - r // > 0: line too far from the center
      const wl = (w(c.a) + w(c.b)) / 2 // the line acts as one body
      const sw = wl + w(c.c)
      if (sw === 0) return
      // Translate the line toward/away from the center (per-endpoint by weight,
      // so a fixed endpoint turns the move into a rotation about it)…
      const lineShift = (err * wl) / sw
      const we = w(c.a) + w(c.b)
      if (we > 0) {
        a.x += nx * lineShift * ((2 * w(c.a)) / we)
        a.y += ny * lineShift * ((2 * w(c.a)) / we)
        b.x += nx * lineShift * ((2 * w(c.b)) / we)
        b.y += ny * lineShift * ((2 * w(c.b)) / we)
      }
      // …and move the center the other way. The radius itself never changes
      // (tangency adjusts positions, not size — matching real CAD).
      ctr.x -= (nx * err * w(c.c)) / sw
      ctr.y -= (ny * err * w(c.c)) / sw
      break
    }
    case 'radius': {
      if (c.shape) {
        // Circle: the radius is shape data, not point positions — direct set.
        const s = data.shapes.find((x) => x.id === c.shape)
        if (s && s.kind === 'circle') s.r = Math.max(0.05, c.value)
      } else if (c.a && c.b) {
        // Arc: drive both endpoint distances to the value.
        distance(P[c.a], P[c.c], w(c.a), w(c.c), c.value)
        distance(P[c.b], P[c.c], w(c.b), w(c.c), c.value)
      }
      break
    }
    case 'angle': {
      if (!P[c.a] || !P[c.b] || !P[c.c] || !P[c.d]) return
      // Directed (no mod-π fold like parallel/perpendicular): 45° and 135° differ.
      const t = (c.value * Math.PI) / 180
      const base = dirMean(angle(P[c.a], P[c.b]), angle(P[c.c], P[c.d]) - t)
      rotateTowardDirected(P[c.a], P[c.b], w(c.a), w(c.b), base)
      rotateTowardDirected(P[c.c], P[c.d], w(c.c), w(c.d), base + t)
      break
    }
  }
}

/** Tangency target radius: the circle's stored r, or the arc's derived radius. */
function tangentTargetRadius(
  data: SketchData,
  c: Extract<Constraint, { kind: 'tangent' }>,
): number {
  if (c.shape) {
    const s = data.shapes.find((x) => x.id === c.shape)
    return s && s.kind === 'circle' ? s.r : 0
  }
  for (const s of data.shapes) {
    if (s.kind !== 'loop' || !s.arcs) continue
    for (const [startPid, arc] of Object.entries(s.arcs)) {
      if (arc.center !== c.c) continue
      const i = s.pts.indexOf(startPid)
      if (i < 0) continue
      const a = data.points[startPid]
      const b = data.points[s.pts[(i + 1) % s.pts.length]]
      const ctr = data.points[arc.center]
      if (!a || !b || !ctr) continue
      return (len(a, ctr) + len(b, ctr)) / 2
    }
  }
  return 0
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
  if (!a || !b || sw === 0 || !Number.isFinite(target)) return
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

  applyRotation(a, b, wa, wb, da)
}

/** Like rotateToward, but directed: the segment's a→b heading matters (no mod-π fold). */
function rotateTowardDirected(a: SPoint, b: SPoint, wa: number, wb: number, target: number): void {
  if (!a || !b || wa + wb === 0) return
  let da = Math.atan2(Math.sin(target - angle(a, b)), Math.cos(target - angle(a, b)))
  da *= ROT_RELAX
  applyRotation(a, b, wa, wb, da)
}

function applyRotation(a: SPoint, b: SPoint, wa: number, wb: number, da: number): void {
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

/** Circular mean of two directed headings (mod 2π). */
function dirMean(x: number, y: number): number {
  return Math.atan2(Math.sin(x) + Math.sin(y), Math.cos(x) + Math.cos(y))
}
