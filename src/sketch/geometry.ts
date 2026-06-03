/** Pure 2D helpers for the sketch editor. Coordinates are mm, Y-up. */
import type { Vec2 } from '../document/types'

/** Signed area of a polygon (positive = CCW in a Y-up frame). */
export function signedArea(poly: Vec2[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]
    const [x2, y2] = poly[(i + 1) % poly.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** Manifold's Positive fill rule fills CCW contours, so normalize winding. */
export function ensureCCW(poly: Vec2[]): Vec2[] {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly
}

/** Axis-aligned rectangle (CCW) from two opposite corners. */
export function makeRectangle(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a[0], b[0])
  const x1 = Math.max(a[0], b[0])
  const y0 = Math.min(a[1], b[1])
  const y1 = Math.max(a[1], b[1])
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ]
}

/** Regular polygon approximating a circle (CCW). */
export function makeCircle(center: Vec2, radius: number, segments = 48): Vec2[] {
  const pts: Vec2[] = []
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2
    pts.push([center[0] + Math.cos(t) * radius, center[1] + Math.sin(t) * radius])
  }
  return pts
}

/** Center of the combined bounding box of all contours. */
export function bboxCenter(contours: Vec2[][]): Vec2 {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of contours) {
    for (const [x, y] of c) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (!Number.isFinite(minX)) return [0, 0]
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** Drop degenerate contours (fewer than 3 points or ~zero area). */
export function cleanContours(contours: Vec2[][]): Vec2[][] {
  return contours.filter((c) => c.length >= 3 && Math.abs(signedArea(c)) > 1e-3).map(ensureCCW)
}

/** Ray-casting point-in-polygon test (for shape hit-testing). */
export function pointInPolygon(poly: Vec2[], p: Vec2): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    const crosses = yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}

/** A "nice" grid step (1/2/5 × 10ⁿ) giving roughly `targetDivisions` lines across `span`. */
export function niceStep(span: number, targetDivisions = 20): number {
  const raw = span / targetDivisions
  const candidates = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
  return candidates.find((c) => c >= raw) ?? 2000
}
