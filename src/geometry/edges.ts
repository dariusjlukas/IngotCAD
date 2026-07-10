/**
 * Pure mesh edge/face analysis on raw triangle arrays — no three.js, no
 * Manifold — so the same code runs in the viewport (picking), the engine
 * worker (edge treatments), and tests.
 *
 * All positions are in the mesh's LOCAL space; callers transform to world.
 */
import type { EdgeSignature, Vec3 } from '../document/types'

export interface MeshArrays {
  /** Flat xyz positions. */
  position: ArrayLike<number>
  /** Triangle indices, or null for non-indexed (soup) geometry. */
  index: ArrayLike<number> | null
}

/** A plane as unit normal + offset (dot(normal, p) = offset). */
export interface FacePlane {
  normal: Vec3
  offset: number
}

export interface BoundaryEdge {
  a: Vec3
  b: Vec3
}

/** Coplanarity thresholds (match the original viewport pickers). */
export const COPLANAR_DOT = 0.9995
export const COPLANAR_OFF = 1e-2

/** Quantize a position so welded (shared) vertices key identically. */
export function quantKey(x: number, y: number, z: number): string {
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function triVertex(mesh: MeshArrays, corner: number): Vec3 {
  const i = mesh.index ? Number(mesh.index[corner]) : corner
  return [
    Number(mesh.position[3 * i]),
    Number(mesh.position[3 * i + 1]),
    Number(mesh.position[3 * i + 2]),
  ]
}

export function triangleCount(mesh: MeshArrays): number {
  return (mesh.index ? mesh.index.length : mesh.position.length / 3) / 3
}

/** Plane of triangle t, or null when degenerate. */
export function trianglePlane(mesh: MeshArrays, t: number): FacePlane | null {
  const a = triVertex(mesh, 3 * t)
  const b = triVertex(mesh, 3 * t + 1)
  const c = triVertex(mesh, 3 * t + 2)
  const n = cross(sub(b, a), sub(c, a))
  const len = norm(n)
  if (len * len < 1e-12) return null
  const unit = scale(n, 1 / len)
  return { normal: unit, offset: dot(unit, a) }
}

/**
 * All boundary edges of the coplanar face containing triangle `faceIndex` —
 * edges used by exactly one triangle of the face, so interior tessellation
 * diagonals are excluded — plus the face's plane.
 */
export function collectCoplanarBoundary(
  mesh: MeshArrays,
  faceIndex: number,
): { edges: BoundaryEdge[]; plane: FacePlane } | null {
  const triCount = triangleCount(mesh)
  if (faceIndex < 0 || faceIndex >= triCount) return null
  const target = trianglePlane(mesh, faceIndex)
  if (!target) return null

  const edges = new Map<string, { count: number; a: Vec3; b: Vec3 }>()
  const addEdge = (p: Vec3, q: Vec3) => {
    const kp = quantKey(p[0], p[1], p[2])
    const kq = quantKey(q[0], q[1], q[2])
    const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`
    const e = edges.get(k)
    if (e) e.count++
    else edges.set(k, { count: 1, a: p, b: q })
  }

  for (let t = 0; t < triCount; t++) {
    const pl = trianglePlane(mesh, t)
    if (!pl) continue
    if (
      dot(pl.normal, target.normal) <= COPLANAR_DOT ||
      Math.abs(pl.offset - target.offset) >= COPLANAR_OFF
    )
      continue
    const a = triVertex(mesh, 3 * t)
    const b = triVertex(mesh, 3 * t + 1)
    const c = triVertex(mesh, 3 * t + 2)
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }

  const out: BoundaryEdge[] = []
  for (const e of edges.values()) if (e.count === 1) out.push({ a: e.a, b: e.b })
  return out.length > 0 ? { edges: out, plane: target } : null
}

// ---------------------------------------------------------------------------
// Planar face groups (for face-reference stale detection)
// ---------------------------------------------------------------------------

export interface PlanarFaceGroup {
  normal: Vec3
  offset: number
  area: number
  centroid: Vec3
}

/**
 * All planar faces of a mesh: triangles bucketed by (quantized) plane. Returns
 * one group per distinct plane with its total area and area-weighted centroid.
 * Curved surfaces dissolve into many tiny groups — callers match against the
 * large planar ones, so that's harmless.
 */
export function planarFaceGroups(mesh: MeshArrays): PlanarFaceGroup[] {
  const triCount = triangleCount(mesh)
  const groups = new Map<
    string,
    { n: Vec3; off: number; area: number; cx: number; cy: number; cz: number }
  >()
  for (let t = 0; t < triCount; t++) {
    const pl = trianglePlane(mesh, t)
    if (!pl) continue
    const a = triVertex(mesh, 3 * t)
    const b = triVertex(mesh, 3 * t + 1)
    const c = triVertex(mesh, 3 * t + 2)
    const area = norm(cross(sub(b, a), sub(c, a))) / 2
    if (area < 1e-12) continue
    // Quantize the plane for bucketing (≈0.6° in normal, 0.005mm in offset).
    const key = `${Math.round(pl.normal[0] * 100)},${Math.round(pl.normal[1] * 100)},${Math.round(
      pl.normal[2] * 100,
    )}|${Math.round(pl.offset * 200)}`
    const g = groups.get(key)
    const cx = (a[0] + b[0] + c[0]) / 3
    const cy = (a[1] + b[1] + c[1]) / 3
    const cz = (a[2] + b[2] + c[2]) / 3
    if (g) {
      g.area += area
      g.cx += cx * area
      g.cy += cy * area
      g.cz += cz * area
    } else {
      groups.set(key, {
        n: pl.normal,
        off: pl.offset,
        area,
        cx: cx * area,
        cy: cy * area,
        cz: cz * area,
      })
    }
  }
  return [...groups.values()].map((g) => ({
    normal: g.n,
    offset: g.off,
    area: g.area,
    centroid: [g.cx / g.area, g.cy / g.area, g.cz / g.area] as Vec3,
  }))
}

// ---------------------------------------------------------------------------
// Circular edge detection
// ---------------------------------------------------------------------------

export interface CircleFit {
  /** Circle center, local space. */
  center: Vec3
  radius: number
  /** Circle axis = the face-plane normal. */
  axis: Vec3
  /** In-plane basis (so callers can sample circle points, e.g. for scale checks). */
  u: Vec3
  v: Vec3
  /** True when the chain spans less than a full loop. */
  arc: boolean
  angularSpanRad: number
}

/** Acceptance guards — exported so tests pin them. */
export const CIRCLE_MIN_VERTICES = 5
export const CIRCLE_MIN_SPAN_RAD = Math.PI / 6 // 30°
export const CIRCLE_MAX_GAP_RAD = Math.PI / 6 // a square's 90° corner gaps fail this
export const CIRCLE_RESIDUAL = (r: number) => Math.max(0.01 * r, 1e-3)

interface Kasa {
  n: number
  sx: number
  sy: number
  sxx: number
  syy: number
  sxy: number
  sxz: number
  syz: number
  sz: number
}

function kasaAdd(k: Kasa, x: number, y: number): void {
  const z = x * x + y * y
  k.n++
  k.sx += x
  k.sy += y
  k.sxx += x * x
  k.syy += y * y
  k.sxy += x * y
  k.sxz += x * z
  k.syz += y * z
  k.sz += z
}

/** Kåsa algebraic least-squares circle: solve x²+y² = 2a·x + 2b·y + c. */
function kasaSolve(k: Kasa): { cx: number; cy: number; r: number } | null {
  // Normal equations for p = [2a, 2b, c]:
  const m = [
    [k.sxx, k.sxy, k.sx / 2],
    [k.sxy, k.syy, k.sy / 2],
    [k.sx, k.sy, k.n / 2],
  ]
  const rhs = [k.sxz / 2, k.syz / 2, k.sz / 2]
  // 3×3 Gaussian elimination with partial pivoting.
  const M = m.map((row, i) => [...row, rhs[i]])
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) return null
    ;[M[col], M[piv]] = [M[piv], M[col]]
    for (let r = 0; r < 3; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c2 = col; c2 < 4; c2++) M[r][c2] -= f * M[col][c2]
    }
  }
  // The reduced system solves p = (a, b, c) directly (center = (a, b)).
  const cx = M[0][3] / M[0][0]
  const cy = M[1][3] / M[1][1]
  const c = M[2][3] / M[2][2]
  const rr = c + cx * cx + cy * cy
  if (!(rr > 0)) return null
  return { cx, cy, r: Math.sqrt(rr) }
}

/** Any unit vector perpendicular to n. */
function perpendicular(n: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const p = cross(n, ref)
  return scale(p, 1 / (norm(p) || 1))
}

/**
 * Detect a circular boundary edge of the coplanar face containing `faceIndex`,
 * near `localPoint`. Walks the boundary loop outward from the nearest edge,
 * growing the chain while a least-squares circle keeps fitting; rejects
 * polygonal corners via residual / span / angular-gap guards.
 */
export function detectCircularEdge(
  mesh: MeshArrays,
  faceIndex: number,
  localPoint: Vec3,
): CircleFit | null {
  const boundary = collectCoplanarBoundary(mesh, faceIndex)
  if (!boundary || boundary.edges.length < CIRCLE_MIN_VERTICES) return null
  const { edges, plane } = boundary

  // 2D frame on the face plane.
  const u = perpendicular(plane.normal)
  const v = cross(plane.normal, u)
  const origin = scale(plane.normal, plane.offset)
  const to2d = (p: Vec3): [number, number] => {
    const d = sub(p, origin)
    return [dot(d, u), dot(d, v)]
  }

  // Vertex adjacency along the boundary loop (welded by quantized key).
  const pts = new Map<string, [number, number]>()
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    const ka = quantKey(e.a[0], e.a[1], e.a[2])
    const kb = quantKey(e.b[0], e.b[1], e.b[2])
    if (!pts.has(ka)) pts.set(ka, to2d(e.a))
    if (!pts.has(kb)) pts.set(kb, to2d(e.b))
    adj.set(ka, [...(adj.get(ka) ?? []), kb])
    adj.set(kb, [...(adj.get(kb) ?? []), ka])
  }

  // Nearest boundary edge to the hit point.
  const p2 = to2d(localPoint)
  let seedA: string | null = null
  let seedB: string | null = null
  let bestD = Infinity
  for (const e of edges) {
    const a = to2d(e.a)
    const b = to2d(e.b)
    const d = distToSeg2(p2, a, b)
    if (d < bestD) {
      bestD = d
      seedA = quantKey(e.a[0], e.a[1], e.a[2])
      seedB = quantKey(e.b[0], e.b[1], e.b[2])
    }
  }
  if (!seedA || !seedB) return null

  // Grow the chain in both directions while the incremental circle fit holds.
  const chain: string[] = [seedA, seedB]
  const inChain = new Set(chain)
  const fits = (keys: string[]): { cx: number; cy: number; r: number } | null => {
    const k: Kasa = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, sxz: 0, syz: 0, sz: 0 }
    for (const id of keys) {
      const q = pts.get(id)!
      kasaAdd(k, q[0], q[1])
    }
    const fit = kasaSolve(k)
    if (!fit) return null
    const tol = CIRCLE_RESIDUAL(fit.r)
    for (const id of keys) {
      const q = pts.get(id)!
      if (Math.abs(Math.hypot(q[0] - fit.cx, q[1] - fit.cy) - fit.r) > tol) return null
    }
    return fit
  }

  let closed = false
  let progress = true
  while (progress && !closed) {
    progress = false
    for (const end of [0, 1] as const) {
      const tip = end === 0 ? chain[0] : chain[chain.length - 1]
      const prev = end === 0 ? chain[1] : chain[chain.length - 2]
      const next = (adj.get(tip) ?? []).find((k2) => k2 !== prev)
      if (!next) continue
      if (inChain.has(next)) {
        // The two growth fronts met: the loop is fully circular.
        if (chain.length >= 3 && fits(chain)) closed = true
        continue
      }
      const candidate = end === 0 ? [next, ...chain] : [...chain, next]
      if (candidate.length >= 3 && !fits(candidate)) continue
      if (end === 0) chain.unshift(next)
      else chain.push(next)
      inChain.add(next)
      progress = true
    }
  }

  if (chain.length < CIRCLE_MIN_VERTICES) return null
  const fit = fits(chain)
  if (!fit) return null

  // Angular span + max gap about the fitted center, walking the chain in order.
  let span = 0
  let maxGap = 0
  let prevAng: number | null = null
  for (const id of chain) {
    const q = pts.get(id)!
    const ang = Math.atan2(q[1] - fit.cy, q[0] - fit.cx)
    if (prevAng !== null) {
      let d = ang - prevAng
      while (d > Math.PI) d -= 2 * Math.PI
      while (d <= -Math.PI) d += 2 * Math.PI
      span += d
      maxGap = Math.max(maxGap, Math.abs(d))
    }
    prevAng = ang
  }
  const spanAbs = closed ? 2 * Math.PI : Math.abs(span)
  if (spanAbs < CIRCLE_MIN_SPAN_RAD || maxGap > CIRCLE_MAX_GAP_RAD) return null

  const center = add(origin, add(scale(u, fit.cx), scale(v, fit.cy)))
  return {
    center,
    radius: fit.r,
    axis: plane.normal,
    u,
    v,
    arc: !closed,
    angularSpanRad: spanAbs,
  }
}

function distToSeg2(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

// ---------------------------------------------------------------------------
// Feature edges (sharp creases) — for edge chamfer/fillet treatments
// ---------------------------------------------------------------------------

export interface FeatureEdge {
  kind: 'line' | 'circle'
  /** Line endpoints (kind 'line'). */
  a?: Vec3
  b?: Vec3
  /** Circle data (kind 'circle'). */
  center?: Vec3
  axis?: Vec3
  radius?: number
  closed?: boolean
  /** Ordered polyline of the underlying chain (for viewport highlighting). */
  points: Vec3[]
  /** Adjacent face normals, sampled on the seed segment. */
  normals: [Vec3, Vec3]
  convex: boolean
  signature: EdgeSignature
}

/** Default crease threshold: faces meeting at more than this are a feature edge. */
export const SHARP_ANGLE_DEG = 25
/** Adjacent chain segments must have compatible side-normals within this. */
const CHAIN_NORMAL_DEG = 25
const LINE_COLLINEAR_DOT = 0.999

interface SharpEdge {
  a: Vec3
  b: Vec3
  ka: string
  kb: string
  n1: Vec3
  n2: Vec3
  convex: boolean
  used: boolean
}

const normalize = (a: Vec3): Vec3 => {
  const l = norm(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * Detect feature edges of a triangle mesh: weld vertices, find manifold edges
 * whose two faces meet sharply, chain them, and classify chains as straight
 * lines or planar circles. Chains that are neither are dropped (v1 scope: no
 * free-form edge treatments).
 */
export function detectFeatureEdges(
  mesh: MeshArrays,
  sharpAngleDeg = SHARP_ANGLE_DEG,
): FeatureEdge[] {
  const triCount = triangleCount(mesh)
  const sharpCos = Math.cos((sharpAngleDeg * Math.PI) / 180)

  // Undirected edge map. The edge direction is stored as wound in the FIRST
  // face seen, so convexity has a consistent frame.
  interface EdgeRec {
    a: Vec3
    b: Vec3
    ka: string
    kb: string
    n1?: Vec3
    n2?: Vec3
    count: number
  }
  const edges = new Map<string, EdgeRec>()
  for (let t = 0; t < triCount; t++) {
    const pl = trianglePlane(mesh, t)
    if (!pl) continue
    const verts = [triVertex(mesh, 3 * t), triVertex(mesh, 3 * t + 1), triVertex(mesh, 3 * t + 2)]
    for (let i = 0; i < 3; i++) {
      const p = verts[i]
      const q = verts[(i + 1) % 3]
      const kp = quantKey(p[0], p[1], p[2])
      const kq = quantKey(q[0], q[1], q[2])
      if (kp === kq) continue
      const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`
      const rec = edges.get(k)
      if (!rec) {
        edges.set(k, { a: p, b: q, ka: kp, kb: kq, n1: pl.normal, count: 1 })
      } else {
        rec.count++
        if (rec.count === 2) rec.n2 = pl.normal
      }
    }
  }

  const sharp: SharpEdge[] = []
  for (const rec of edges.values()) {
    if (rec.count !== 2 || !rec.n1 || !rec.n2) continue
    if (dot(rec.n1, rec.n2) >= sharpCos) continue
    // Convex iff the second face folds AWAY from the first along the winding.
    const e = sub(rec.b, rec.a)
    const convex = dot(cross(rec.n1, rec.n2), e) > 0
    sharp.push({
      a: rec.a,
      b: rec.b,
      ka: rec.ka,
      kb: rec.kb,
      n1: rec.n1,
      n2: rec.n2,
      convex,
      used: false,
    })
  }

  // Vertex → incident sharp edges.
  const incident = new Map<string, SharpEdge[]>()
  for (const e of sharp) {
    incident.set(e.ka, [...(incident.get(e.ka) ?? []), e])
    incident.set(e.kb, [...(incident.get(e.kb) ?? []), e])
  }

  const chainCos = Math.cos((CHAIN_NORMAL_DEG * Math.PI) / 180)
  const compatible = (x: SharpEdge, y: SharpEdge): boolean => {
    // Each of x's side-normals must continue into one of y's.
    return (
      (dot(x.n1, y.n1) > chainCos && dot(x.n2, y.n2) > chainCos) ||
      (dot(x.n1, y.n2) > chainCos && dot(x.n2, y.n1) > chainCos)
    )
  }

  /** Walk forward from `tip`, marking edges used and appending vertex keys. */
  const grow = (
    last: () => SharpEdge,
    push: (e: SharpEdge) => void,
    tipKey: string,
    keys: string[],
  ): void => {
    let tip = tipKey
    for (;;) {
      const l = last()
      const candidates = (incident.get(tip) ?? []).filter(
        (e) => !e.used && e.convex === l.convex && compatible(e, l),
      )
      if (candidates.length !== 1) return
      const next = candidates[0]
      next.used = true
      push(next)
      tip = next.ka === tip ? next.kb : next.ka
      keys.push(tip)
      if (keys.length > 100000) return // safety
    }
  }

  const keyPos = new Map<string, Vec3>()
  for (const e of sharp) {
    keyPos.set(e.ka, e.a)
    keyPos.set(e.kb, e.b)
  }

  const out: FeatureEdge[] = []
  for (const seed of sharp) {
    if (seed.used) continue
    seed.used = true
    const fwdEdges: SharpEdge[] = [seed]
    const fwd: string[] = [seed.kb]
    grow(
      () => fwdEdges[fwdEdges.length - 1],
      (e) => fwdEdges.push(e),
      seed.kb,
      fwd,
    )
    const backEdges: SharpEdge[] = [seed]
    const back: string[] = [seed.ka]
    grow(
      () => backEdges[backEdges.length - 1],
      (e) => backEdges.push(e),
      seed.ka,
      back,
    )
    const keys = [...back.reverse(), ...fwd]
    const closed = keys.length > 2 && keys[0] === keys[keys.length - 1]
    const pts = (closed ? keys.slice(0, -1) : keys).map((k) => keyPos.get(k)!)

    const feature = classifyChain(pts, closed, seed)
    if (feature) out.push(feature)
  }
  return out
}

function classifyChain(pts: Vec3[], closed: boolean, sample: SharpEdge): FeatureEdge | null {
  if (pts.length < 2) return null

  // Straight line: every segment parallel to the overall direction.
  if (!closed) {
    const d0 = normalize(sub(pts[pts.length - 1], pts[0]))
    let straight = norm(sub(pts[pts.length - 1], pts[0])) > 1e-6
    for (let i = 0; straight && i + 1 < pts.length; i++) {
      const d = normalize(sub(pts[i + 1], pts[i]))
      if (Math.abs(dot(d, d0)) < LINE_COLLINEAR_DOT) straight = false
    }
    if (straight) {
      const a = pts[0]
      const b = pts[pts.length - 1]
      const length = norm(sub(b, a))
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
      return {
        kind: 'line',
        a,
        b,
        points: [a, b],
        normals: [sample.n1, sample.n2],
        convex: sample.convex,
        signature: {
          kind: 'line',
          point: mid,
          dir: d0,
          length,
          normals: [sample.n1, sample.n2],
        },
      }
    }
  }

  // Planar circle: axis from consecutive segment crosses, Kåsa fit in-plane.
  if (pts.length >= CIRCLE_MIN_VERTICES) {
    let ax: Vec3 = [0, 0, 0]
    const n = pts.length
    const segCount = closed ? n : n - 1
    for (let i = 0; i + 1 < segCount; i++) {
      const d1 = sub(pts[(i + 1) % n], pts[i])
      const d2 = sub(pts[(i + 2) % n], pts[(i + 1) % n])
      const c = cross(d1, d2)
      // Keep one hemisphere so a zig-zag chain cancels instead of accumulating.
      ax = dot(ax, c) < 0 ? sub(ax, c) : add(ax, c)
    }
    if (norm(ax) < 1e-9) return null
    const axis = normalize(ax)
    const u = perpendicular(axis)
    const v = cross(axis, u)
    const origin = pts[0]
    const k: Kasa = { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, sxz: 0, syz: 0, sz: 0 }
    const planeOff = dot(axis, origin)
    for (const p of pts) {
      if (Math.abs(dot(axis, p) - planeOff) > 0.05) return null // not planar
      const d = sub(p, origin)
      kasaAdd(k, dot(d, u), dot(d, v))
    }
    const fit = kasaSolve(k)
    if (!fit) return null
    const tol = Math.max(1e-2, 1e-3 * fit.r)
    for (const p of pts) {
      const d = sub(p, origin)
      const r = Math.hypot(dot(d, u) - fit.cx, dot(d, v) - fit.cy)
      if (Math.abs(r - fit.r) > tol) return null
    }
    const center = add(origin, add(scale(u, fit.cx), scale(v, fit.cy)))
    return {
      kind: 'circle',
      center,
      axis,
      radius: fit.r,
      closed,
      points: pts,
      normals: [sample.n1, sample.n2],
      convex: sample.convex,
      signature: {
        kind: 'circle',
        point: center,
        dir: axis,
        length: 2 * Math.PI * fit.r,
        radius: fit.r,
        normals: [sample.n1, sample.n2],
      },
    }
  }
  return null
}

/** Matching tolerances (exported so tests pin them). */
export const MATCH_DIR_COS = Math.cos((5 * Math.PI) / 180)
export const MATCH_LINE_DIST = 0.1
export const MATCH_OVERLAP = 0.5
/** Loose-fallback position gate: proportional to the edge size so a param edit
 *  (an edge drifting a few mm) still rebinds, but a parallel edge on another
 *  object does not. */
export const MATCH_LOOSE_DIST = (size: number): number => Math.max(2, 0.5 * size)
/** Loose-fallback radius gate for circles. */
export const MATCH_LOOSE_RADIUS = (r: number): number => Math.max(1, 0.5 * r)

/**
 * Find the detected edge a stored signature refers to. Tolerant by design so
 * child param edits and sibling treatments don't orphan entries:
 * - lines match by direction + containment in the supporting line + interval
 *   overlap; fallback: the unique candidate with matching direction AND normals
 *   whose midpoint stayed within a length-proportional distance.
 * - circles match by axis + center + radius; fallback: the unique axis match
 *   with a nearby center and a compatible radius.
 * Ambiguity returns null (surfaced as a warning), never a guess.
 */
export function matchEdge(
  sig: EdgeSignature,
  candidates: FeatureEdge[],
): { edge: FeatureEdge; exact: boolean } | null {
  if (sig.kind === 'line') {
    const half = scale(sig.dir, sig.length / 2)
    const p0 = sub(sig.point, half)
    const p1 = add(sig.point, half)
    const exact = candidates.filter((c) => {
      if (c.kind !== 'line' || !c.a || !c.b) return false
      const cd = normalize(sub(c.b, c.a))
      if (Math.abs(dot(cd, sig.dir)) < MATCH_DIR_COS) return false
      // Midpoint distance to the candidate's supporting (infinite) line.
      const ap = sub(sig.point, c.a)
      const perp = sub(ap, scale(cd, dot(ap, cd)))
      if (norm(perp) > MATCH_LINE_DIST) return false
      // Interval overlap along the line, relative to the shorter span.
      const len = norm(sub(c.b, c.a))
      const t0 = dot(sub(p0, c.a), cd)
      const t1 = dot(sub(p1, c.a), cd)
      const overlap = Math.min(Math.max(t0, t1), len) - Math.max(Math.min(t0, t1), 0)
      return overlap >= MATCH_OVERLAP * Math.min(sig.length, len)
    })
    if (exact.length === 1) return { edge: exact[0], exact: true }
    if (exact.length > 1) return null // ambiguous
    const loose = candidates.filter((c) => {
      if (c.kind !== 'line' || !c.a || !c.b) return false
      const cd = normalize(sub(c.b, c.a))
      if (Math.abs(dot(cd, sig.dir)) < MATCH_DIR_COS) return false
      if (!normalsMatch(sig.normals, c.normals)) return false
      const mid = scale(add(c.a, c.b), 0.5)
      return norm(sub(mid, sig.point)) <= MATCH_LOOSE_DIST(sig.length)
    })
    return loose.length === 1 ? { edge: loose[0], exact: false } : null
  }

  const r = sig.radius ?? 0
  const tol = Math.max(0.5, 0.05 * r)
  const exact = candidates.filter((c) => {
    if (c.kind !== 'circle' || !c.center || !c.axis || c.radius == null) return false
    if (Math.abs(dot(c.axis, sig.dir)) < MATCH_DIR_COS) return false
    return norm(sub(c.center, sig.point)) < tol && Math.abs(c.radius - r) < tol
  })
  if (exact.length === 1) return { edge: exact[0], exact: true }
  if (exact.length > 1) return null
  const loose = candidates.filter((c) => {
    if (c.kind !== 'circle' || !c.center || !c.axis || c.radius == null) return false
    if (Math.abs(dot(c.axis, sig.dir)) < MATCH_DIR_COS) return false
    return (
      norm(sub(c.center, sig.point)) <= MATCH_LOOSE_DIST(r) &&
      Math.abs(c.radius - r) <= MATCH_LOOSE_RADIUS(r)
    )
  })
  return loose.length === 1 ? { edge: loose[0], exact: false } : null
}

function normalsMatch(a: [Vec3, Vec3], b: [Vec3, Vec3]): boolean {
  const m = (x: Vec3, y: Vec3) => dot(x, y) > MATCH_DIR_COS
  return (m(a[0], b[0]) && m(a[1], b[1])) || (m(a[0], b[1]) && m(a[1], b[0]))
}
