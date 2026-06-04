/**
 * Constraint-based sketch model. Geometry is defined by shared points; shapes
 * (closed loops, circles) reference points; constraints relate points. A solver
 * (solver.ts) adjusts point positions to satisfy the constraints. On commit the
 * solved points become contours fed to the (unchanged) Manifold extrude path.
 *
 * Segments are not first-class — a "segment" is just a pair of point ids (an
 * edge of a loop), which keeps contour extraction trivial (loops are explicit
 * ordered point lists) while still allowing edge-level constraints.
 */
import type { Vec2 } from '../document/types'
import { ensureCCW, makeCircle } from './geometry'

export type PointId = string
export type ShapeId = string
export type ConstraintId = string

export interface SPoint {
  x: number
  y: number
  /** Anchored points are never moved by the solver. */
  fixed: boolean
}

export type Shape =
  | { id: ShapeId; kind: 'loop'; pts: PointId[] }
  | { id: ShapeId; kind: 'circle'; c: PointId; r: number }

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'equal'
  | 'parallel'
  | 'perpendicular'

export type Constraint =
  | { id: ConstraintId; kind: 'coincident'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'horizontal'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'vertical'; a: PointId; b: PointId }
  // `offset` is display-only: the signed perpendicular distance (mm) at which
  // the dimension line is drawn. The solver ignores it.
  | { id: ConstraintId; kind: 'distance'; a: PointId; b: PointId; value: number; offset?: number }
  | { id: ConstraintId; kind: 'equal'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'parallel'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'perpendicular'; a: PointId; b: PointId; c: PointId; d: PointId }

export interface SketchData {
  points: Record<PointId, SPoint>
  shapes: Shape[]
  constraints: Constraint[]
}

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

/** Solved closed contours (mm, Y-up) for extrusion. */
export function shapeContours(data: SketchData): Vec2[][] {
  const out: Vec2[][] = []
  for (const s of data.shapes) {
    if (s.kind === 'loop') {
      const pts = s.pts
        .map((id) => data.points[id])
        .filter((p): p is SPoint => Boolean(p))
        .map((p) => [p.x, p.y] as Vec2)
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

/** Distributes Omit over a union so discriminant-specific fields survive. */
export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
/** A constraint minus its id, for creation. */
export type ConstraintInput = DistributiveOmit<Constraint, 'id'>

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
