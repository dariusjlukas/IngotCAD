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

/** Arc facets used to round a fillet at a 90° corner (scaled by sweep angle). */
export const FILLET_SEGMENTS = 16

interface CornerFrame {
  /** Unit direction from the corner toward its previous neighbor. */
  ua: Vec2
  /** Unit direction from the corner toward its next neighbor. */
  ub: Vec2
  /** Half the interior angle at the corner (radians). */
  half: number
  lenA: number
  lenB: number
}

/** Edge directions/lengths and half-angle at a corner; null when degenerate. */
function cornerFrame(prev: Vec2, corner: Vec2, next: Vec2): CornerFrame | null {
  const ax = prev[0] - corner[0]
  const ay = prev[1] - corner[1]
  const bx = next[0] - corner[0]
  const by = next[1] - corner[1]
  const lenA = Math.hypot(ax, ay)
  const lenB = Math.hypot(bx, by)
  if (lenA < 1e-6 || lenB < 1e-6) return null
  const ua: Vec2 = [ax / lenA, ay / lenA]
  const ub: Vec2 = [bx / lenB, by / lenB]
  const cos = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]))
  const theta = Math.acos(cos) // interior angle, 0..π
  // Near-collinear or a zero-width spike can't be rounded/beveled.
  if (theta < 1e-3 || theta > Math.PI - 1e-3) return null
  return { ua, ub, half: theta / 2, lenA, lenB }
}

/**
 * Largest fillet radius / chamfer setback that fits a corner: the per-edge
 * setback is capped at half of each adjacent edge so neighbouring corner
 * treatments can never cross. Returns 0 for a corner that can't be treated.
 */
export function maxCornerSize(
  prev: Vec2,
  corner: Vec2,
  next: Vec2,
  kind: 'fillet' | 'chamfer',
): number {
  const f = cornerFrame(prev, corner, next)
  if (!f) return 0
  const tMax = Math.min(f.lenA, f.lenB) * 0.5
  return kind === 'fillet' ? tMax * Math.tan(f.half) : tMax
}

/**
 * The points that replace a loop corner once a fillet/chamfer is applied.
 * `prev`/`next` are the adjacent loop vertices (mm). A chamfer returns the two
 * setback points; a fillet returns a faceted tangent arc (from the prev-edge
 * tangent to the next-edge tangent, so it splices into the loop in order). The
 * setback/radius is clamped to fit the corner (see maxCornerSize). Returns
 * `[corner]` unchanged for a degenerate corner or non-positive size.
 */
export function cornerPoints(
  prev: Vec2,
  corner: Vec2,
  next: Vec2,
  kind: 'fillet' | 'chamfer',
  size: number,
  segments = FILLET_SEGMENTS,
): Vec2[] {
  const f = cornerFrame(prev, corner, next)
  if (!f || size <= 0) return [corner]
  const { ua, ub, half } = f
  const tMax = Math.min(f.lenA, f.lenB) * 0.5

  if (kind === 'chamfer') {
    const d = Math.min(size, tMax)
    if (d <= 1e-6) return [corner]
    return [
      [corner[0] + ua[0] * d, corner[1] + ua[1] * d],
      [corner[0] + ub[0] * d, corner[1] + ub[1] * d],
    ]
  }

  const r = Math.min(size, tMax * Math.tan(half))
  if (r <= 1e-6) return [corner]
  const t = r / Math.tan(half) // tangent setback along each edge
  const t1: Vec2 = [corner[0] + ua[0] * t, corner[1] + ua[1] * t]
  const t2: Vec2 = [corner[0] + ub[0] * t, corner[1] + ub[1] * t]
  // Arc center sits along the interior bisector at r / sin(half) from the corner.
  let bx = ua[0] + ub[0]
  let by = ua[1] + ub[1]
  const bl = Math.hypot(bx, by) || 1
  bx /= bl
  by /= bl
  const dc = r / Math.sin(half)
  const cx = corner[0] + bx * dc
  const cy = corner[1] + by * dc
  const a1 = Math.atan2(t1[1] - cy, t1[0] - cx)
  const a2 = Math.atan2(t2[1] - cy, t2[0] - cx)
  let sweep = a2 - a1
  while (sweep <= -Math.PI) sweep += 2 * Math.PI
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  const n = Math.max(2, Math.ceil((segments * Math.abs(sweep)) / (Math.PI / 2)))
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const ang = a1 + sweep * (i / n)
    out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r])
  }
  return out
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
