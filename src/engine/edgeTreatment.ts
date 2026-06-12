/**
 * Edge chamfer/fillet construction: re-detect the sharp edges of the evaluated
 * child solid, match each stored entry's signature, and subtract a per-edge cut
 * tool (a wedge prism for chamfers; wedge-minus-tangent-cylinder for fillets;
 * the revolved equivalents for closed circular edges like cylinder rims).
 *
 * v1 scope: CONVEX edges only, straight + closed circular. The cut tool is
 * always built from the freshly DETECTED edge — the signature is only the
 * matching key — so treatments track the child's current geometry. Limitations
 * (documented): square tool ends leave a small un-blended notch where two
 * treated edges meet (no corner patches), and concave edges warn + skip.
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
  /** Outward bisector (out of the material at a convex edge). */
  bOut: Vec3
  /** Inward bisector between the faces (into the material). */
  bIn: Vec3
}

/** Cross-section frame at an edge with adjacent normals n1/n2 and tangent d. */
function edgeFrame(n1: Vec3, n2: Vec3, d: Vec3): EdgeCrossFrame | null {
  let t1 = normalize(cross(n1, d))
  let t2 = normalize(cross(n2, d))
  // Sign-fix: each tangent points into its own face, away from the other face.
  if (dot(t1, n2) > 0) t1 = scale(t1, -1)
  if (dot(t2, n1) > 0) t2 = scale(t2, -1)
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
  to2d: (v: Vec3) => Vec2,
  at: Vec2,
): CrossSection | null {
  const t1 = to2d(f.t1)
  const t2 = to2d(f.t2)
  const out = to2d(f.bOut)
  const apex: Vec2 = [at[0] + out[0] * APEX_EPSILON, at[1] + out[1] * APEX_EPSILON]

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
  const f = edgeFrame(edge.normals[0], edge.normals[1], d)
  if (!f) return null
  // Right-handed frame (u, v, d): u × v = d.
  const u = f.t1
  const v = normalize(cross(d, f.t1))
  const to2d = (x: Vec3): Vec2 => [dot(x, u), dot(x, v)]
  const profile = cutProfile2D(M, kind, size, f, to2d, [0, 0])
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
  const f = edgeFrame(edge.normals[0], edge.normals[1], d)
  if (!f) return null
  const to2d = (x: Vec3): Vec2 => [dot(x, rho), dot(x, zhat)]
  const profile = cutProfile2D(M, kind, size, f, to2d, [R, 0])
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

  const tools: Manifold[] = []
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
    if (!match.edge.convex) {
      warn({
        code: 'edge-concave-unsupported',
        entryId: entry.id,
        message: 'Concave edges are not supported yet; the treatment was skipped.',
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
    tools.push(tool)
  }

  if (tools.length === 0) return base
  const cut = tools.length === 1 ? tools[0] : M.Manifold.union(tools)
  if (tools.length > 1) tools.forEach((t) => t.delete())
  const result = base.subtract(cut)
  cut.delete()
  base.delete()
  return result
}
