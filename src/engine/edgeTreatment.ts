/**
 * Edge chamfer/fillet construction: re-detect the sharp edges of the evaluated
 * child solid, match each stored entry's signature, and apply a per-edge tool
 * (a wedge prism for chamfers; wedge-minus-tangent-cylinder for fillets; the
 * revolved equivalents for closed circular edges like cylinder rims). Convex
 * edges SUBTRACT their tool (material is removed at an outside corner);
 * concave edges UNION the mirrored tool (an inside corner is filled) — the 2D
 * profile construction is identical, only the tangent orientation, apex side,
 * and boolean op flip.
 *
 * Scope: straight + closed circular edges. The tool is always built from the
 * freshly DETECTED edge — the signature is only the matching key — so
 * treatments track the child's current geometry. Limitation (documented):
 * square tool ends leave a small un-blended notch where two treated edges
 * meet (no corner patches).
 */
import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d'
import type { EdgeTreatmentEntry, Vec2, Vec3 } from '../document/types'
import type { EvalWarning } from './protocol'
import { detectFeatureEdges, matchEdge } from '../geometry/edges'
import type { FeatureEdge } from '../geometry/edges'
import { ensureCCW } from '../sketch/geometry'

type Wasm = ManifoldToplevel

/** Tiny outward inflation of the cut tool's apex so its surface never lies
 *  exactly on the edge (degenerate coincident-face boolean). */
const APEX_EPSILON = 1e-3
const FILLET_SEGMENTS = 64

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const normalize = (a: Vec3): Vec3 => {
  const l = norm(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Column-major 4×4 from an orthonormal basis (columns) + origin. */
function basisMatrix(u: Vec3, v: Vec3, w: Vec3, origin: Vec3): number[] {
  // prettier-ignore
  return [
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    w[0], w[1], w[2], 0,
    origin[0], origin[1], origin[2], 1,
  ]
}

/** Any unit vector perpendicular to n. */
function perpendicular(n: Vec3): Vec3 {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  return normalize(cross(n, ref))
}

interface EdgeCrossFrame {
  /** In-face tangents at the edge (each points away from the edge, into its face). */
  t1: Vec3
  t2: Vec3
  /** Bisector of the face normals: always points AWAY from the material at the edge. */
  bOut: Vec3
  /** Bisector between the in-face tangents: for a convex edge it points into the
   *  material; for a concave edge into the cavity (where the fillet circle sits). */
  bIn: Vec3
}

/**
 * Cross-section frame at an edge with adjacent normals n1/n2 and tangent d.
 * The tangent sign-fix depends on convexity: at a convex edge each face lies on
 * the NEGATIVE side of the other face's normal; at a concave (inside) edge each
 * face lies on the POSITIVE side.
 */
function edgeFrame(n1: Vec3, n2: Vec3, d: Vec3, convex: boolean): EdgeCrossFrame | null {
  let t1 = normalize(cross(n1, d))
  let t2 = normalize(cross(n2, d))
  const sign = convex ? 1 : -1
  if (sign * dot(t1, n2) > 0) t1 = scale(t1, -1)
  if (sign * dot(t2, n1) > 0) t2 = scale(t2, -1)
  if (norm(add(t1, t2)) < 1e-6 || norm(add(n1, n2)) < 1e-6) return null
  return { t1, t2, bOut: normalize(add(n1, n2)), bIn: normalize(add(t1, t2)) }
}

/**
 * The 2D cut profile in an (x, y) frame where the edge passes through `at`:
 * a chamfer is the wedge triangle between the two face setbacks; a fillet is
 * that wedge (setback to the tangency points) minus the tangent circle.
 * `to2d` projects 3D cross-frame vectors into the 2D plane (must be isometric
 * for the d-perpendicular components — true for both callers).
 */
function cutProfile2D(
  M: Wasm,
  kind: 'chamfer' | 'fillet',
  size: number,
  f: EdgeCrossFrame,
  convex: boolean,
  to2d: (v: Vec3) => Vec2,
  at: Vec2,
): CrossSection | null {
  const t1 = to2d(f.t1)
  const t2 = to2d(f.t2)
  const out = to2d(f.bOut)
  // The apex sits exactly on the edge; nudge it past the body surface so the
  // boolean never sees a coincident face. A subtract tool (convex) pokes OUT of
  // the material; a union tool (concave) overlaps INTO it.
  const apexSign = convex ? APEX_EPSILON : -APEX_EPSILON
  const apex: Vec2 = [at[0] + out[0] * apexSign, at[1] + out[1] * apexSign]

  if (kind === 'chamfer') {
    const tri: Vec2[] = [
      apex,
      [at[0] + t1[0] * size, at[1] + t1[1] * size],
      [at[0] + t2[0] * size, at[1] + t2[1] * size],
    ]
    return new M.CrossSection([ensureCCW(tri)], 'Positive')
  }

  // Fillet: tangent-circle center at k·bIn from the edge. Since n1 ⊥ t1 and
  // bIn/n1/t1 are coplanar (all ⊥ d): |dot(bIn, n1)| = √(1 − dot(bIn, t1)²).
  const cosT = dot(f.bIn, f.t1)
  const sinHalf = Math.sqrt(Math.max(1e-12, 1 - cosT * cosT))
  const k = size / sinHalf
  const sPrime = k * cosT // face setback to the tangency points
  if (!(sPrime > 1e-9)) return null
  const bIn = to2d(f.bIn)
  const tri: Vec2[] = [
    apex,
    [at[0] + t1[0] * sPrime, at[1] + t1[1] * sPrime],
    [at[0] + t2[0] * sPrime, at[1] + t2[1] * sPrime],
  ]
  const wedge = new M.CrossSection([ensureCCW(tri)], 'Positive')
  const circle = M.CrossSection.circle(size, FILLET_SEGMENTS).translate([
    at[0] + bIn[0] * k,
    at[1] + bIn[1] * k,
  ])
  const result = wedge.subtract(circle)
  wedge.delete()
  circle.delete()
  return result
}

function lineTool(
  M: Wasm,
  kind: 'chamfer' | 'fillet',
  size: number,
  edge: FeatureEdge,
): Manifold | null {
  if (!edge.a || !edge.b) return null
  const length = norm(sub(edge.b, edge.a))
  if (length < 1e-6) return null
  const d = normalize(sub(edge.b, edge.a))
  const f = edgeFrame(edge.normals[0], edge.normals[1], d, edge.convex)
  if (!f) return null
  // Right-handed frame (u, v, d): u × v = d.
  const u = f.t1
  const v = normalize(cross(d, f.t1))
  const to2d = (x: Vec3): Vec2 => [dot(x, u), dot(x, v)]
  const profile = cutProfile2D(M, kind, size, f, edge.convex, to2d, [0, 0])
  if (!profile) return null
  const prism = profile.extrude(length, 0, 0, undefined, false)
  profile.delete()
  const placed = prism.transform(basisMatrix(u, v, d, edge.a) as unknown as Mat4)
  prism.delete()
  return placed
}

function circleTool(
  M: Wasm,
  kind: 'chamfer' | 'fillet',
  size: number,
  edge: FeatureEdge,
): Manifold | null {
  if (!edge.center || !edge.axis || edge.radius == null || !edge.closed) return null
  const R = edge.radius
  if (size >= R - 0.1) return null // the cut would reach the axis
  // Build the profile in the (radial x, axial y) half-plane at a sample point
  // (exact for surfaces of revolution), with the edge at (R, 0).
  const S = edge.points[0]
  const rho = normalize(sub(S, edge.center))
  const zhat = edge.axis
  const d = normalize(cross(zhat, rho)) // circle tangent at S
  const f = edgeFrame(edge.normals[0], edge.normals[1], d, edge.convex)
  if (!f) return null
  const to2d = (x: Vec3): Vec2 => [dot(x, rho), dot(x, zhat)]
  const profile = cutProfile2D(M, kind, size, f, edge.convex, to2d, [R, 0])
  if (!profile) return null
  // Revolve about the cross-section's Y axis → a solid around local Z.
  const solid = profile.revolve(FILLET_SEGMENTS, 360)
  profile.delete()
  const p = perpendicular(zhat)
  const q = normalize(cross(zhat, p))
  const placed = solid.transform(basisMatrix(p, q, zhat, edge.center) as unknown as Mat4)
  solid.delete()
  return placed
}

/**
 * Apply the entries to `base` (consumed). Unmatched / unsupported entries are
 * skipped and reported through `warn`.
 */
export function applyEdgeTreatments(
  M: Wasm,
  base: Manifold,
  entries: EdgeTreatmentEntry[],
  warn: (w: Omit<EvalWarning, 'nodeId'>) => void,
): Manifold {
  if (entries.length === 0) return base

  const mesh = base.getMesh()
  const { numProp, vertProperties, triVerts } = mesh
  let position: Float32Array
  if (numProp === 3) {
    position = vertProperties
  } else {
    const vertCount = vertProperties.length / numProp
    position = new Float32Array(vertCount * 3)
    for (let i = 0; i < vertCount; i++) {
      position[i * 3] = vertProperties[i * numProp]
      position[i * 3 + 1] = vertProperties[i * numProp + 1]
      position[i * 3 + 2] = vertProperties[i * numProp + 2]
    }
  }
  const detected = detectFeatureEdges({ position, index: triVerts })

  const cutTools: Manifold[] = [] // convex edges: material removed
  const fillTools: Manifold[] = [] // concave edges: material added
  for (const entry of entries) {
    const match = matchEdge(entry.edge, detected)
    if (!match) {
      warn({
        code: 'edge-unmatched',
        entryId: entry.id,
        message: 'The picked edge no longer exists on this shape; the treatment was skipped.',
      })
      continue
    }
    const tool =
      match.edge.kind === 'line'
        ? lineTool(M, entry.kind, entry.size, match.edge)
        : circleTool(M, entry.kind, entry.size, match.edge)
    if (!tool) {
      warn({
        code: 'edge-too-large',
        entryId: entry.id,
        message: 'The chamfer/fillet size does not fit this edge; the treatment was skipped.',
      })
      continue
    }
    ;(match.edge.convex ? cutTools : fillTools).push(tool)
  }

  if (cutTools.length === 0 && fillTools.length === 0) return base

  const combine = (tools: Manifold[]): Manifold => {
    if (tools.length === 1) return tools[0]
    const u = M.Manifold.union(tools)
    tools.forEach((t) => t.delete())
    return u
  }

  let result = base
  if (cutTools.length > 0) {
    const cut = combine(cutTools)
    const next = result.subtract(cut)
    cut.delete()
    result.delete()
    result = next
  }
  if (fillTools.length > 0) {
    const fill = combine(fillTools)
    const next = result.add(fill)
    fill.delete()
    result.delete()
    result = next
  }
  return result
}
