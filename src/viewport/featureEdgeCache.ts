/**
 * Per-geometry cache of detected feature edges for the edge-treatment picking
 * mode. Detection is O(triangles) with chaining on top — too heavy to run per
 * pointer-move — and a BufferGeometry is immutable once derived, so a WeakMap
 * keyed on the geometry is exactly right (entries vanish with the geometry).
 */
import type * as THREE from 'three'
import { detectFeatureEdges } from '../geometry/edges'
import type { FeatureEdge } from '../geometry/edges'

const cache = new WeakMap<THREE.BufferGeometry, FeatureEdge[]>()

export function featureEdgesOf(geometry: THREE.BufferGeometry): FeatureEdge[] {
  const hit = cache.get(geometry)
  if (hit) return hit
  const pos = geometry.getAttribute('position')
  if (!pos) return []
  const edges = detectFeatureEdges({
    position: pos.array as ArrayLike<number>,
    index: geometry.index?.array ?? null,
  })
  cache.set(geometry, edges)
  return edges
}

/** Nearest feature edge to a local-space point (distance to its polyline). */
export function nearestFeatureEdge(
  edges: FeatureEdge[],
  p: [number, number, number],
): { edge: FeatureEdge; dist: number } | null {
  let best: FeatureEdge | null = null
  let bestD = Infinity
  for (const e of edges) {
    const pts = e.points
    for (let i = 0; i + 1 < Math.max(2, pts.length); i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const d = distToSeg(p, a, b)
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
    // Closed circles: include the wrap-around segment.
    if (e.kind === 'circle' && e.closed && pts.length > 2) {
      const d = distToSeg(p, pts[pts.length - 1], pts[0])
      if (d < bestD) {
        bestD = d
        best = e
      }
    }
  }
  return best ? { edge: best, dist: bestD } : null
}

function distToSeg(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abz = b[2] - a[2]
  const l2 = abx * abx + aby * aby + abz * abz
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby), p[2] - (a[2] + t * abz))
}
