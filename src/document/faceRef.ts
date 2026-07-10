/**
 * Pure face-reference math for stale detection ("associativity lite").
 *
 * A FaceRef stores a face's plane in the SOURCE node's local space. To decide
 * whether a dependent plane/sketch is stale we (1) re-find that local face on
 * the source's current mesh (it may have moved or vanished after param edits),
 * then (2) compose the matched local plane with the source's current world
 * transform and compare against the dependent's stored world snapshot.
 *
 * The document is never auto-rewritten: callers surface the result and offer an
 * explicit, undoable Rebind.
 */
import * as THREE from 'three'
import type { CadDocument, FaceRef, NodeId, Vec3 } from './types'
import { hasChildren } from './types'
import type { PlanarFaceGroup } from '../geometry/edges'
import { transformToMatrix4 } from '../geometry/transform'

/**
 * World matrix of a node: its transform composed with every ancestor's (a node
 * picked as a root may since have been wrapped in a group/boolean/treatment).
 */
export function worldMatrixOf(doc: CadDocument, id: NodeId): THREE.Matrix4 | null {
  if (!doc.nodes[id]) return null
  const parentOf = new Map<NodeId, NodeId>()
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (hasChildren(node)) for (const cid of node.childIds) parentOf.set(cid, nid)
  }
  const chain: NodeId[] = []
  for (let cur: NodeId | undefined = id; cur; cur = parentOf.get(cur)) chain.push(cur)
  const m = new THREE.Matrix4()
  for (const nid of chain.reverse()) {
    m.multiply(transformToMatrix4(doc.nodes[nid].transform))
  }
  return m
}

export interface WorldPlane {
  normal: Vec3
  /** A point on the plane (world mm). */
  point: Vec3
}

/** Local-face match tolerances. */
export const EXACT_ANGLE_COS = Math.cos((1 * Math.PI) / 180)
export const EXACT_OFFSET_MM = 0.05
export const MOVED_ANGLE_COS = Math.cos((10 * Math.PI) / 180)
export const MOVED_OFFSET_MM = 5

export type FaceRefStatus =
  | { status: 'ok'; local: { normal: Vec3; offset: number } }
  | { status: 'moved'; local: { normal: Vec3; offset: number } }
  | { status: 'missing' }

/**
 * Re-find the referenced face among the source's current planar face groups
 * (LOCAL space). `ok` = same plane within tight tolerance; `moved` = a unique
 * best candidate within loose tolerance; `missing` = none, or ambiguous (two
 * equally-plausible faces never silently bind).
 */
export function matchFaceRef(ref: FaceRef, groups: PlanarFaceGroup[]): FaceRefStatus {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const exact = groups.filter(
    (g) =>
      dot(g.normal, ref.normal) > EXACT_ANGLE_COS &&
      Math.abs(g.offset - ref.offset) < EXACT_OFFSET_MM,
  )
  if (exact.length > 0) {
    // Multiple coincident-plane groups are the same face; take the largest.
    const best = exact.reduce((a, b) => (a.area >= b.area ? a : b))
    return { status: 'ok', local: { normal: best.normal, offset: best.offset } }
  }
  const candidates = groups
    .filter(
      (g) =>
        dot(g.normal, ref.normal) > MOVED_ANGLE_COS &&
        Math.abs(g.offset - ref.offset) < MOVED_OFFSET_MM,
    )
    // Closest plane wins — sorting by area here would let a big face beat a
    // strictly closer (more plausible) small one and bind the wrong face.
    .sort((a, b) => Math.abs(a.offset - ref.offset) - Math.abs(b.offset - ref.offset))
  if (candidates.length === 0) return { status: 'missing' }
  // Unique enough: the runner-up (if any) must be clearly worse in offset.
  if (candidates.length > 1) {
    const d0 = Math.abs(candidates[0].offset - ref.offset)
    const d1 = Math.abs(candidates[1].offset - ref.offset)
    if (d1 < 2 * Math.max(d0, 0.1)) return { status: 'missing' } // ambiguous
  }
  return { status: 'moved', local: { normal: candidates[0].normal, offset: candidates[0].offset } }
}

/** Compose a local plane with the source's current world matrix → world plane. */
export function composeFaceWorld(
  m: THREE.Matrix4,
  local: { normal: Vec3; offset: number },
): WorldPlane {
  const nm = new THREE.Matrix3().getNormalMatrix(m)
  const n = new THREE.Vector3(...local.normal).applyMatrix3(nm).normalize()
  const p = new THREE.Vector3(
    local.normal[0] * local.offset,
    local.normal[1] * local.offset,
    local.normal[2] * local.offset,
  ).applyMatrix4(m)
  return { normal: [n.x, n.y, n.z], point: [p.x, p.y, p.z] }
}

/** Whether two world planes agree within the exact tolerances. */
export function worldPlanesAgree(a: WorldPlane, b: { normal: Vec3; origin: Vec3 }): boolean {
  const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  if (dot(a.normal, b.normal) < EXACT_ANGLE_COS) return false
  // Distance of b's origin from a's plane.
  const d =
    dot(a.normal, b.origin) -
    (a.normal[0] * a.point[0] + a.normal[1] * a.point[1] + a.normal[2] * a.point[2])
  return Math.abs(d) < EXACT_OFFSET_MM
}
