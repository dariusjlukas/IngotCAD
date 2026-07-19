/**
 * Face-associativity resolver (Stage A of docs/design-associativity.md).
 *
 * Pure derivation: given the document and the current LOCAL meshes of source
 * nodes, compute where every face-attached dependent (construction planes,
 * face-attached extrusions/revolutions) should sit NOW — following its source
 * face automatically. Nothing here writes the document; the stored snapshot
 * (plane / transform) remains the serialized fallback and the authority for
 * "where the attachment was last acknowledged".
 *
 * The core move: resolution applies the rigid DELTA between the stored
 * snapshot plane and the re-matched face plane to the stored transform
 * (`T_resolved = Δ ∘ T_stored`). When the face hasn't drifted, Δ is identity
 * and resolved === stored exactly; a user's manual gizmo offset relative to
 * the face survives resolution because it lives inside `T_stored`.
 *
 * Frame transport: a FaceRef may carry the attach-time plane frame in the
 * SOURCE's local space (`ref.frame`). Composing it with the source's current
 * world matrix tracks in-plane translation/rotation of the source — invisible
 * to the plane equation alone. Legacy refs without a frame fall back to
 * snapping the stored world snapshot onto the re-matched plane (exact for
 * moves along the face normal, best-effort otherwise).
 *
 * Failure is never silent and never destructive: a missing/ambiguous face or
 * a dependency cycle freezes the dependent at its snapshot with status
 * 'missing' — exactly the pre-associativity behavior.
 */
import * as THREE from 'three'
import type { CadDocument, FaceRef, NodeId, SketchPlane, Transform, Vec3 } from './types'
import { hasChildren } from './types'
import { composeFaceWorld, matchFaceRef, worldPlanesAgree } from './faceRef'
import type { WorldPlane } from './faceRef'
import { planarFaceGroups } from '../geometry/edges'
import type { MeshArrays } from '../geometry/edges'
import { matrix4ToTransform, transformToMatrix4 } from '../geometry/transform'

/** Local triangle arrays of a source node, or null if unavailable right now. */
export type MeshLookup = (nodeId: NodeId) => MeshArrays | null

export type ResolveStatus =
  /** Face found where the snapshot expects it — resolved === stored. */
  | 'ok'
  /** Face found elsewhere — the dependent FOLLOWS it (resolved ≠ stored). */
  | 'moved'
  /** Face gone/ambiguous/cyclic — dependent FROZEN at its stored snapshot. */
  | 'missing'

export interface ResolvedDependent {
  /** Construction-plane id or node id. */
  key: string
  kind: 'plane' | 'node'
  label: string
  status: ResolveStatus
  /** Resolved world plane frame (the sketch plane for nodes). */
  plane: SketchPlane
  /** Nodes only: resolved transform in the node's PARENT space. */
  nodeTransform?: Transform
  /** The re-matched face plane in the source's local space (for re-anchoring). */
  local?: { normal: Vec3; offset: number }
}

export interface ResolveResult {
  dependents: Record<string, ResolvedDependent>
  /** Keys refused because following them would create a dependency cycle. */
  cycles: string[]
}

export interface Dependent {
  key: string
  kind: 'plane' | 'node'
  label: string
  ref: FaceRef
  /** Stored world snapshot frame the dependent currently renders from. */
  snapshot: SketchPlane
  /** Nodes only: the stored parent-relative transform. */
  storedTransform?: Transform
}

// --- small vector/frame helpers (kept local: document/ must not import sketch/) --

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2])
const arr3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z]

function basisMatrix(plane: SketchPlane): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeBasis(v3(plane.u), v3(plane.v), v3(plane.n))
  m.setPosition(plane.origin[0], plane.origin[1], plane.origin[2])
  return m
}

/** Re-orthonormalize a frame around its normal (drops shear/scale residue). */
function orthonormalize(origin: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3): SketchPlane {
  const nn = n.clone().normalize()
  let uu = u.clone().addScaledVector(nn, -u.dot(nn))
  if (uu.lengthSq() < 1e-12) {
    const ref = Math.abs(nn.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)
    uu = new THREE.Vector3().crossVectors(ref, nn)
  }
  uu.normalize()
  const vv = new THREE.Vector3().crossVectors(nn, uu)
  return { origin: arr3(origin), u: arr3(uu), v: arr3(vv), n: arr3(nn) }
}

/** Map a (possibly local) frame through a world matrix, then orthonormalize. */
function composeFrame(m: THREE.Matrix4, frame: SketchPlane): SketchPlane {
  const nm = new THREE.Matrix3().getNormalMatrix(m)
  const origin = v3(frame.origin).applyMatrix4(m)
  const u = v3(frame.u).transformDirection(m)
  const n = v3(frame.n).applyNormalMatrix(nm)
  return orthonormalize(origin, u, n)
}

/**
 * Snap a candidate frame onto a target world plane: minimal rotation aligning
 * the frame normal, then a translation along the target normal onto the plane.
 * In-plane position and rotation are preserved — they are exactly the
 * information the plane equation cannot express.
 */
function snapFrameToPlane(candidate: SketchPlane, target: WorldPlane): SketchPlane {
  const n0 = v3(candidate.n).normalize()
  const n1 = v3(target.normal).normalize()
  const q = new THREE.Quaternion().setFromUnitVectors(n0, n1)
  const origin = v3(candidate.origin)
  const u = v3(candidate.u).applyQuaternion(q)
  const n = n0.clone().applyQuaternion(q)
  const d = n1.dot(v3(target.point).sub(origin))
  origin.addScaledVector(n1, d)
  return orthonormalize(origin, u, n)
}

// --- document walks ---------------------------------------------------------

/** Every face-attached dependent in the document (planes first, then nodes). */
export function collectDependents(doc: CadDocument): Dependent[] {
  const out: Dependent[] = []
  for (const pid of doc.planeOrder) {
    const plane = doc.planes[pid]
    const def = plane?.definition
    if (def?.kind === 'face' && def.source) {
      // Snapshot frame: the stored origin/normal (the offset is applied on
      // top of the resolved frame, exactly like resolvePlaneDefinition does).
      const snap = orthonormalize(v3(def.origin), new THREE.Vector3(1, 0, 0), v3(def.normal))
      out.push({ key: pid, kind: 'plane', label: plane.name, ref: def.source, snapshot: snap })
    }
  }
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'primitive') continue
    const p = node.params
    if ((p.type !== 'extrusion' && p.type !== 'revolution') || !p.sketch?.faceRef) continue
    out.push({
      key: node.id,
      kind: 'node',
      label: node.name,
      ref: p.sketch.faceRef,
      snapshot: p.sketch.plane,
      storedTransform: node.transform,
    })
  }
  return out
}

function parentMap(doc: CadDocument): Map<NodeId, NodeId> {
  const parentOf = new Map<NodeId, NodeId>()
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (hasChildren(node)) for (const cid of node.childIds) parentOf.set(cid, nid)
  }
  return parentOf
}

function isInSubtree(doc: CadDocument, rootId: NodeId, id: NodeId): boolean {
  if (rootId === id) return true
  const node = doc.nodes[rootId]
  if (!node || !hasChildren(node)) return false
  return node.childIds.some((cid) => isInSubtree(doc, cid, id))
}

/**
 * A dependent's chain of sources: its ref source, that node's own ref source
 * (if it is itself face-attached), and so on. A cycle exists when the chain
 * revisits a node, or when any source's subtree contains the dependent (the
 * source's geometry would then depend on the dependent's placement).
 */
function detectCycle(doc: CadDocument, dep: Dependent, refOfNode: Map<NodeId, FaceRef>): boolean {
  const seen = new Set<NodeId>()
  let cur: NodeId | undefined = dep.ref.nodeId
  while (cur) {
    if (seen.has(cur)) return true
    seen.add(cur)
    if (dep.kind === 'node' && isInSubtree(doc, cur, dep.key)) return true
    cur = refOfNode.get(cur)?.nodeId
  }
  return false
}

/** World matrix of a node, preferring resolved transforms for ancestors. */
function worldMatrixWith(
  doc: CadDocument,
  id: NodeId,
  parentOf: Map<NodeId, NodeId>,
  resolved: Map<NodeId, Transform>,
): THREE.Matrix4 | null {
  if (!doc.nodes[id]) return null
  const chain: NodeId[] = []
  for (let cur: NodeId | undefined = id; cur; cur = parentOf.get(cur)) chain.push(cur)
  const m = new THREE.Matrix4()
  for (const nid of chain.reverse()) {
    m.multiply(transformToMatrix4(resolved.get(nid) ?? doc.nodes[nid].transform))
  }
  return m
}

// --- the resolver -----------------------------------------------------------

/**
 * Resolve every face-attached dependent against the sources' current meshes.
 * Dependents attached to other dependents resolve in dependency order, so a
 * plane on a face of an extrusion that itself follows a face composes both
 * motions. Missing meshes (not yet evaluated) freeze that dependent for this
 * pass — the next resolve after evaluation catches up.
 */
export function resolveDocument(doc: CadDocument, meshes: MeshLookup): ResolveResult {
  const deps = collectDependents(doc)
  const result: ResolveResult = { dependents: {}, cycles: [] }
  if (deps.length === 0) return result

  const parentOf = parentMap(doc)
  const refOfNode = new Map<NodeId, FaceRef>()
  for (const d of deps) if (d.kind === 'node') refOfNode.set(d.key, d.ref)

  // Dependency order: if B is attached to a face of dependent A, A resolves
  // first so B composes A's resolved placement. Kahn's algorithm over the
  // direct source edges; on a cycle, take any (cycle detection freezes it).
  const order: Dependent[] = []
  const pending = [...deps]
  const unresolvedNodeKeys = new Set(deps.filter((d) => d.kind === 'node').map((d) => d.key))
  while (pending.length > 0) {
    const idx = pending.findIndex(
      (d) => d.ref.nodeId === d.key || !unresolvedNodeKeys.has(d.ref.nodeId),
    )
    const [dep] = pending.splice(Math.max(idx, 0), 1)
    order.push(dep)
    unresolvedNodeKeys.delete(dep.key)
  }

  /** Resolved parent-relative transforms of node dependents, for ancestors. */
  const resolvedTransforms = new Map<NodeId, Transform>()
  /** Face-group cache: one mesh analysis per source per pass. */
  const groupCache = new Map<NodeId, ReturnType<typeof planarFaceGroups> | null>()

  for (const dep of order) {
    const frozen: ResolvedDependent = {
      key: dep.key,
      kind: dep.kind,
      label: dep.label,
      status: 'missing',
      plane: dep.snapshot,
      nodeTransform: dep.storedTransform,
    }

    if (detectCycle(doc, dep, refOfNode)) {
      result.cycles.push(dep.key)
      result.dependents[dep.key] = frozen
      continue
    }
    const src = doc.nodes[dep.ref.nodeId]
    if (!src) {
      result.dependents[dep.key] = frozen
      continue
    }
    if (!groupCache.has(dep.ref.nodeId)) {
      const mesh = meshes(dep.ref.nodeId)
      groupCache.set(dep.ref.nodeId, mesh ? planarFaceGroups(mesh) : null)
    }
    const groups = groupCache.get(dep.ref.nodeId)
    const world = worldMatrixWith(doc, dep.ref.nodeId, parentOf, resolvedTransforms)
    if (!groups || !world) {
      result.dependents[dep.key] = frozen
      continue
    }

    const match = matchFaceRef(dep.ref, groups)
    if (match.status === 'missing') {
      result.dependents[dep.key] = frozen
      continue
    }

    // Where the face plane is NOW, in world space.
    const target = composeFaceWorld(world, match.local)
    // Candidate frame carrying the in-plane anchor: the attach-time local
    // frame transported by the source's current matrix, else the stored
    // world snapshot (legacy refs — plane-equation-only transport).
    const candidate = dep.ref.frame ? composeFrame(world, dep.ref.frame) : dep.snapshot
    const plane = snapFrameToPlane(candidate, target)

    const drifted =
      !worldPlanesAgree(target, { normal: dep.snapshot.n, origin: dep.snapshot.origin }) ||
      !framesAgree(plane, dep.snapshot)

    const entry: ResolvedDependent = {
      key: dep.key,
      kind: dep.kind,
      label: dep.label,
      status: drifted ? 'moved' : 'ok',
      plane: drifted ? plane : dep.snapshot,
      local: match.local,
    }

    if (dep.kind === 'node' && dep.storedTransform) {
      if (!drifted) {
        entry.nodeTransform = dep.storedTransform
      } else {
        // T_resolved = Δ ∘ T_stored, with Δ the snapshot→resolved frame delta
        // applied in WORLD space, then re-expressed in the parent's space.
        const delta = basisMatrix(plane).multiply(basisMatrix(dep.snapshot).invert())
        const parentId = parentOf.get(dep.key)
        const parentWorld = parentId
          ? (worldMatrixWith(doc, parentId, parentOf, resolvedTransforms) ?? new THREE.Matrix4())
          : new THREE.Matrix4()
        const storedWorld = parentWorld.clone().multiply(transformToMatrix4(dep.storedTransform))
        const resolvedWorld = delta.multiply(storedWorld)
        const local = parentWorld.invert().multiply(resolvedWorld)
        entry.nodeTransform = matrix4ToTransform(local)
        resolvedTransforms.set(dep.key, entry.nodeTransform)
      }
    }
    result.dependents[dep.key] = entry
  }
  return result
}

/**
 * Express a world plane frame in a source node's LOCAL space — the inverse of
 * the resolver's frame transport. Used when re-anchoring an attachment (the
 * stored `FaceRef.frame` must describe the acknowledged plane in the source's
 * current local space). `overrides` lets the caller account for sources that
 * are themselves auto-following.
 */
export function frameInSourceLocal(
  doc: CadDocument,
  sourceId: NodeId,
  plane: SketchPlane,
  overrides: Record<NodeId, Transform> = {},
): SketchPlane | undefined {
  const world = worldMatrixWith(doc, sourceId, parentMap(doc), new Map(Object.entries(overrides)))
  if (!world) return undefined
  return composeFrame(world.invert(), plane)
}

const FRAME_EPS_MM = 0.05
const FRAME_EPS_DOT = Math.cos((1 * Math.PI) / 180)

function framesAgree(a: SketchPlane, b: SketchPlane): boolean {
  const dp = v3(a.origin).distanceTo(v3(b.origin))
  return (
    dp < FRAME_EPS_MM &&
    v3(a.n).dot(v3(b.n)) > FRAME_EPS_DOT &&
    v3(a.u).dot(v3(b.u)) > FRAME_EPS_DOT
  )
}
