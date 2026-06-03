/**
 * Parametric sketch shapes. Each shape keeps its defining parameters (a rect
 * knows its width/height, a circle its radius) so dimensions can be displayed
 * and edited. `shapeToContour` turns a shape into the CCW point list handed to
 * Manifold's CrossSection.extrude.
 */
import type { Vec2 } from '../document/types'
import { makeCircle, pointInPolygon } from './geometry'

export type SketchShape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number } // min corner (x,y) + size
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'polygon'; points: Vec2[] }

/** Segments used to facet a circle for extrusion. */
export const CIRCLE_SEGMENTS = 64

export function shapeToContour(shape: SketchShape): Vec2[] {
  switch (shape.kind) {
    case 'rect':
      return [
        [shape.x, shape.y],
        [shape.x + shape.w, shape.y],
        [shape.x + shape.w, shape.y + shape.h],
        [shape.x, shape.y + shape.h],
      ]
    case 'circle':
      return makeCircle([shape.cx, shape.cy], shape.r, CIRCLE_SEGMENTS)
    case 'polygon':
      return shape.points
  }
}

export function translateShape(shape: SketchShape, dx: number, dy: number): SketchShape {
  switch (shape.kind) {
    case 'rect':
      return { ...shape, x: shape.x + dx, y: shape.y + dy }
    case 'circle':
      return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy }
    case 'polygon':
      return { ...shape, points: shape.points.map(([x, y]) => [x + dx, y + dy] as Vec2) }
  }
}

export function pointInShape(shape: SketchShape, p: Vec2): boolean {
  switch (shape.kind) {
    case 'rect':
      return p[0] >= shape.x && p[0] <= shape.x + shape.w && p[1] >= shape.y && p[1] <= shape.y + shape.h
    case 'circle':
      return Math.hypot(p[0] - shape.cx, p[1] - shape.cy) <= shape.r
    case 'polygon':
      return pointInPolygon(shape.points, p)
  }
}

/** Label shown for a shape's primary dimension(s). */
export function shapeLabel(shape: SketchShape): string {
  switch (shape.kind) {
    case 'rect':
      return `${round(shape.w)} × ${round(shape.h)}`
    case 'circle':
      return `⌀${round(shape.r * 2)}`
    case 'polygon':
      return `${shape.points.length} pts`
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}
