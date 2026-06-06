/**
 * Constraint-based sketch behavior. The sketch *data types* now live in
 * document/types (so a sketch-based solid can store its editable source on the
 * node); this module re-exports them and provides the behavior: contour
 * extraction, segment/constraint helpers, etc.
 *
 * Segments are not first-class — a "segment" is just a pair of point ids (an
 * edge of a loop), which keeps contour extraction trivial.
 */
import type {
  Constraint,
  ConstraintKind,
  PointId,
  ShapeId,
  SketchData,
  SketchShape,
  SPoint,
  Vec2,
} from '../document/types'
import { cornerPoints, ensureCCW, FILLET_SEGMENTS, makeCircle } from './geometry'

type LoopShape = Extract<SketchShape, { kind: 'loop' }>

// Canonical home of these types is document/types; re-export so existing
// imports from './model' keep working.
export type {
  Constraint,
  ConstraintInput,
  ConstraintKind,
  PointId,
  ShapeId,
  ConstraintId,
  SketchData,
  SPoint,
} from '../document/types'
export type { SketchShape as Shape } from '../document/types'

/** Segments used to facet a circle for extrusion. */
export const CIRCLE_SEGMENTS = 64

export function emptySketch(): SketchData {
  return { points: {}, shapes: [], constraints: [] }
}

/** Consecutive point pairs of a closed loop. */
export function loopSegments(pts: PointId[]): [PointId, PointId][] {
  const segs: [PointId, PointId][] = []
  for (let i = 0; i < pts.length; i++) segs.push([pts[i], pts[(i + 1) % pts.length]])
  return segs
}

/** All point ids a constraint references (for validation / cleanup). */
export function constraintPoints(c: Constraint): PointId[] {
  switch (c.kind) {
    case 'coincident':
    case 'horizontal':
    case 'vertical':
    case 'distance':
      return [c.a, c.b]
    case 'equal':
    case 'parallel':
    case 'perpendicular':
      return [c.a, c.b, c.c, c.d]
  }
}

const KIND_SHORT: Record<ConstraintKind, string> = {
  coincident: '⌖',
  horizontal: '—',
  vertical: '|',
  distance: '↔',
  equal: '=',
  parallel: '∥',
  perpendicular: '⊥',
}

export function constraintLabel(c: Constraint): string {
  if (c.kind === 'distance') return `↔ ${Math.round(c.value * 100) / 100}`
  return `${KIND_SHORT[c.kind]} ${c.kind}`
}

/**
 * A loop's outline (mm, Y-up), with any fillet/chamfer corners expanded to
 * points. The single source of the expanded shape — used by both contour
 * extraction (below) and the on-screen sketch path so they always agree.
 */
export function loopOutline(data: SketchData, loop: LoopShape, segments = FILLET_SEGMENTS): Vec2[] {
  const verts = loop.pts
    .map((id) => ({ id, p: data.points[id] }))
    .filter((v): v is { id: PointId; p: SPoint } => Boolean(v.p))
  const n = verts.length
  const base = verts.map((v) => [v.p.x, v.p.y] as Vec2)
  if (!loop.corners || n < 3) return base
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const t = loop.corners[verts[i].id]
    if (t && t.size > 0) {
      const prev = base[(i - 1 + n) % n]
      const next = base[(i + 1) % n]
      out.push(...cornerPoints(prev, base[i], next, t.kind, t.size, segments))
    } else {
      out.push(base[i])
    }
  }
  return out
}

/** Neighbour positions of a loop corner (cyclic); null for non-corner points. */
export function cornerNeighbors(data: SketchData, pid: PointId): { prev: Vec2; next: Vec2 } | null {
  for (const s of data.shapes) {
    if (s.kind !== 'loop') continue
    const i = s.pts.indexOf(pid)
    if (i < 0) continue
    const n = s.pts.length
    if (n < 3) return null
    return {
      prev: pointPos(data, s.pts[(i - 1 + n) % n]),
      next: pointPos(data, s.pts[(i + 1) % n]),
    }
  }
  return null
}

/** Solved closed contours (mm, Y-up) for extrusion. Construction shapes are reference-only. */
export function shapeContours(data: SketchData): Vec2[][] {
  const out: Vec2[][] = []
  for (const s of data.shapes) {
    if (s.construction) continue
    if (s.kind === 'loop') {
      const pts = loopOutline(data, s)
      if (pts.length >= 3) out.push(ensureCCW(pts))
    } else {
      const c = data.points[s.c]
      if (c && s.r > 0) out.push(makeCircle([c.x, c.y], s.r, CIRCLE_SEGMENTS))
    }
  }
  return out
}

export function pointPos(data: SketchData, id: PointId): Vec2 {
  const p = data.points[id]
  return p ? [p.x, p.y] : [0, 0]
}

export function shapeIdOfPoint(data: SketchData, pid: PointId): ShapeId | null {
  for (const s of data.shapes) {
    if (s.kind === 'loop' && s.pts.includes(pid)) return s.id
    if (s.kind === 'circle' && s.c === pid) return s.id
  }
  return null
}

/** Remove a shape, its owned points, and any constraints that referenced them. */
export function removeShapeFromData(data: SketchData, shapeId: ShapeId): void {
  const shape = data.shapes.find((s) => s.id === shapeId)
  if (!shape) return
  const pts = new Set<PointId>(shape.kind === 'loop' ? shape.pts : [shape.c])
  data.shapes = data.shapes.filter((s) => s.id !== shapeId)
  for (const id of pts) delete data.points[id]
  data.constraints = data.constraints.filter((c) => !constraintPoints(c).some((p) => pts.has(p)))
}
