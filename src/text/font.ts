/**
 * Text → 2D contour tessellation for the text tool.
 *
 * Uses three.js's bundled Helvetiker typeface (no extra dependency) and its
 * FontLoader to turn a string into filled glyph outlines, then flattens those
 * outlines to polygons that feed the same extrusion path as a sketch profile.
 * The font JSON is loaded once via Vite's `?url` (same pattern as the Manifold
 * wasm) and parsed behind a shared promise.
 *
 * Output contours are origin-centered (mm, Y-up): the outer glyph loops plus the
 * counter (hole) loops, in three.js's native winding — the engine extrudes them
 * with the even-odd rule, so winding doesn't matter and counters stay hollow.
 */
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import type { Font } from 'three/addons/loaders/FontLoader.js'
import fontUrl from 'three/examples/fonts/helvetiker_regular.typeface.json?url'
import type { Vec2 } from '../document/types'
import { bboxCenter } from '../sketch/geometry'

/** Segments per glyph curve when flattening — enough to read smoothly at print scale. */
const CURVE_DIVISIONS = 6

let fontPromise: Promise<Font> | null = null

function loadFont(): Promise<Font> {
  if (!fontPromise) {
    fontPromise = fetch(fontUrl)
      .then((r) => r.json())
      .then((data) => new FontLoader().parse(data))
  }
  return fontPromise
}

/**
 * Tessellated, origin-centered glyph contours (mm, Y-up) for `text` at the given
 * cap `size`. Empty when there is nothing renderable (e.g. only whitespace).
 */
export async function textToContours(text: string, size: number): Promise<Vec2[][]> {
  const font = await loadFont()
  const shapes = font.generateShapes(text, size)
  const contours: Vec2[][] = []
  for (const shape of shapes) {
    contours.push(shape.getPoints(CURVE_DIVISIONS).map((p) => [p.x, p.y] as Vec2))
    for (const hole of shape.holes) {
      contours.push(hole.getPoints(CURVE_DIVISIONS).map((p) => [p.x, p.y] as Vec2))
    }
  }
  const cleaned = contours.filter((c) => c.length >= 3)
  if (cleaned.length === 0) return []
  // Center on the origin so the node's transform places the label predictably.
  const [cx, cy] = bboxCenter(cleaned)
  return cleaned.map((c) => c.map(([x, y]) => [x - cx, y - cy] as Vec2))
}
