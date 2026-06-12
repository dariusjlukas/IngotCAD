/**
 * The application store: the CAD document, the current selection, and the undo
 * history — plus the actions that mutate them.
 *
 * Document edits go through `mutate`, which produces a new immutable document
 * (via immer) and pushes the previous one onto the undo stack. Selection and
 * transient state changes do NOT touch history. Gizmo drags write to the store
 * exactly once, on release, so a whole drag is a single undo step.
 */
import { create } from 'zustand'
import { produce } from 'immer'
import { nanoid } from 'nanoid'
import type {
  BooleanOp,
  CadDocument,
  CadNode,
  EdgeTreatmentEntry,
  MeshAsset,
  NodeId,
  PatternMode,
  PatternSpec,
  PlaneDefinition,
  PrimitiveParams,
  PrimitiveType,
  Role,
  SketchSource,
  Transform,
  Vec2,
  Vec3,
} from './types'
import { createEmptyDocument, hasChildren, IDENTITY_TRANSFORM } from './types'
import { transformToMatrix4, matrix4ToTransform } from '../geometry/transform'
import { bakeScaleIntoParams } from './scaleBake'
import { cleanContours } from '../sketch/geometry'

const HISTORY_LIMIT = 100

const PALETTE = ['#6ea8fe', '#7bd88f', '#ffd866', '#ff6188', '#ab9df2', '#fc9867', '#78dce8']

const TYPE_LABEL: Record<PrimitiveType, string> = {
  box: 'Box',
  cylinder: 'Cylinder',
  sphere: 'Sphere',
  mesh: 'Mesh',
  extrusion: 'Sketch',
  revolution: 'Revolve',
  text: 'Text',
}

function defaultParams(type: PrimitiveType): PrimitiveParams {
  switch (type) {
    case 'box':
      return { type: 'box', size: [20, 20, 20] }
    case 'cylinder':
      return { type: 'cylinder', height: 20, radiusBottom: 10, radiusTop: 10, segments: 48 }
    case 'sphere':
      return { type: 'sphere', radius: 12, segments: 32 }
    case 'mesh':
      return { type: 'mesh', assetId: '' }
    case 'extrusion':
      return { type: 'extrusion', profile: [], height: 10 }
    case 'revolution':
      return { type: 'revolution', profile: [], degrees: 360, segments: 64 }
    case 'text':
      // Real text is created via `addText` (which tessellates a profile); this
      // empty default only satisfies the type for the generic creation path.
      return { type: 'text', text: 'Text', size: 10, height: 4, profile: [] }
  }
}

/** Height of the primitive's center above the build plate so it rests on z=0. */
function restingZ(params: PrimitiveParams): number {
  switch (params.type) {
    case 'box':
      return params.size[2] / 2
    case 'cylinder':
      return params.height / 2
    case 'sphere':
      return params.radius
    case 'mesh':
      return 0
    case 'extrusion':
      return params.height / 2
    case 'revolution':
      return 0 // the profile's own Y becomes Z, so no extra lift
    case 'text':
      return 0 // extruded 0..height from the plate, so it already rests on z=0
  }
}

/** Compose a parent transform with a child transform (parent ∘ child). */
function composeTransforms(parent: Transform, child: Transform): Transform {
  const m = transformToMatrix4(parent).multiply(transformToMatrix4(child))
  return matrix4ToTransform(m)
}

function collectSubtree(doc: CadDocument, id: NodeId, acc: Set<NodeId>): void {
  if (acc.has(id)) return
  acc.add(id)
  const node = doc.nodes[id]
  if (node && hasChildren(node)) node.childIds.forEach((c) => collectSubtree(doc, c, acc))
}

/** Remove any container nodes that have ended up with no children. */
function cleanupEmptyContainers(doc: CadDocument): void {
  let changed = true
  while (changed) {
    changed = false
    for (const node of Object.values(doc.nodes)) {
      if (hasChildren(node) && node.childIds.length === 0) {
        delete doc.nodes[node.id]
        doc.rootIds = doc.rootIds.filter((id) => id !== node.id)
        for (const other of Object.values(doc.nodes)) {
          if (hasChildren(other)) other.childIds = other.childIds.filter((c) => c !== node.id)
        }
        changed = true
      }
    }
  }
}

const DUP_OFFSET = 4 // mm; nudge a duplicate/paste so it doesn't hide the original

/** Where a dragged node lands relative to a drop target. */
export type DropPosition = 'before' | 'after' | 'inside'

interface ClipboardData {
  nodes: Record<NodeId, CadNode>
  rootIds: NodeId[]
  assets: Record<string, MeshAsset>
}

/** The container node id whose childIds includes `id`, or null if `id` is a root. */
function parentNodeId(doc: CadDocument, id: NodeId): NodeId | null {
  for (const n of Object.values(doc.nodes)) {
    if (hasChildren(n) && n.childIds.includes(id)) return n.id
  }
  return null
}

/** The array `id` lives in (doc.rootIds or its container's childIds), or null. */
function parentArray(doc: CadDocument, id: NodeId): NodeId[] | null {
  if (doc.rootIds.includes(id)) return doc.rootIds
  for (const n of Object.values(doc.nodes)) {
    if (hasChildren(n) && n.childIds.includes(id)) return n.childIds
  }
  return null
}

/** The top-level (root) ancestor of `id`. */
export function rootOf(doc: CadDocument, id: NodeId): NodeId {
  let cur = id
  for (let p = parentNodeId(doc, cur); p; p = parentNodeId(doc, cur)) cur = p
  return cur
}

/** Keep only ids that aren't descendants of another id in the list. */
function topLevelOf(doc: CadDocument, ids: NodeId[]): NodeId[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    let p = parentNodeId(doc, id)
    while (p) {
      if (set.has(p)) return false
      p = parentNodeId(doc, p)
    }
    return true
  })
}

/** Default name base for a boolean of the given operation. */
function combineLabel(op: BooleanOp): string {
  return op === 'union' ? 'Union' : op === 'subtract' ? 'Difference' : 'Intersection'
}

/** Default name base for a pattern of the given mode. */
const PATTERN_LABEL: Record<PatternMode, string> = {
  linear: 'Linear Pattern',
  circular: 'Circular Pattern',
  mirror: 'Mirror',
}

/** Starting parameters for each pattern mode (edited afterward in the panel). */
export const DEFAULT_PATTERN_SPEC: Record<PatternMode, PatternSpec> = {
  linear: { mode: 'linear', count: 3, offset: [25, 0, 0] },
  circular: {
    mode: 'circular',
    count: 6,
    angleDeg: 360,
    axisOrigin: [0, 0, 0],
    axisDir: [0, 0, 1],
  },
  mirror: { mode: 'mirror', planeOrigin: [0, 0, 0], planeNormal: [1, 0, 0], keepOriginal: true },
}

/** Starting wall thickness (mm) for a new shell. */
export const DEFAULT_SHELL_THICKNESS = 2

/** How a freshly-created sketch solid folds into an existing object. */
export interface CombineTarget {
  /** A node whose root ancestor the new solid is combined with. */
  targetId: NodeId
  op: 'union' | 'subtract'
}

/**
 * Fold a just-created root solid `newId` into the root containing `targetId`,
 * replacing both roots with a boolean of the two (mutating the immer draft).
 * Child order is [target, new] so `subtract` cuts the new solid out of the
 * target. Either way the result is the target object modified in place, so it
 * keeps the target's color. Returns the boolean's id, or null if the target
 * root is gone or is the new solid itself (in which case the caller keeps the
 * standalone solid).
 */
function wrapInBoolean(
  doc: CadDocument,
  targetId: NodeId,
  newId: NodeId,
  op: BooleanOp,
  name: string,
): NodeId | null {
  const targetRoot = rootOf(doc, targetId)
  if (targetRoot === newId || !doc.rootIds.includes(targetRoot) || !doc.rootIds.includes(newId))
    return null
  const bid = nanoid()
  const firstIdx = doc.rootIds.indexOf(targetRoot)
  doc.nodes[bid] = {
    id: bid,
    kind: 'boolean',
    op,
    name,
    childIds: [targetRoot, newId],
    color: doc.nodes[targetRoot].color,
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM },
  }
  doc.rootIds = doc.rootIds.filter((rid) => rid !== targetRoot && rid !== newId)
  doc.rootIds.splice(firstIdx, 0, bid)
  doc.featureOrder.push(bid)
  return bid
}

/** World transform of `id` = composition of its ancestor transforms (root→node). */
function worldTransform(doc: CadDocument, id: NodeId): Transform {
  const chain: Transform[] = []
  let cur: NodeId | null = id
  while (cur) {
    const n = doc.nodes[cur]
    if (!n) break
    chain.unshift(n.transform)
    cur = parentNodeId(doc, cur)
  }
  return chain.reduce((acc, t) => composeTransforms(acc, t), IDENTITY_TRANSFORM)
}

/** Accumulated world scale of `id` (product of its own + ancestor scales). */
export function worldScale(doc: CadDocument, id: NodeId): Vec3 {
  return worldTransform(doc, id).scale
}

/** The local transform `id` needs under `destParentId` to keep its world pose. */
function localTransformUnder(doc: CadDocument, id: NodeId, destParentId: NodeId | null): Transform {
  const destWorld = transformToMatrix4(
    destParentId ? worldTransform(doc, destParentId) : IDENTITY_TRANSFORM,
  )
  const world = transformToMatrix4(worldTransform(doc, id))
  return matrix4ToTransform(destWorld.invert().multiply(world))
}

type CloneSource = Pick<CadDocument, 'nodes' | 'assets'>

/**
 * Deep-clone the subtree at `srcId` from `src` into `doc` with fresh ids. `src`
 * must be a plain (non-immer-draft) object so structuredClone is safe; `doc` is
 * the draft being written. Mesh assets are copied in if missing.
 */
function cloneSubtree(src: CloneSource, doc: CadDocument, srcId: NodeId): NodeId | null {
  const srcNode = src.nodes[srcId]
  if (!srcNode) return null
  const newId = nanoid()
  const clone = structuredClone(srcNode)
  clone.id = newId
  if (hasChildren(clone) && hasChildren(srcNode)) {
    clone.childIds = srcNode.childIds
      .map((cid) => cloneSubtree(src, doc, cid))
      .filter((cid): cid is NodeId => cid !== null)
  } else if (clone.kind === 'primitive' && clone.params.type === 'mesh') {
    const assetId = clone.params.assetId
    if (!doc.assets[assetId] && src.assets[assetId]) {
      doc.assets[assetId] = structuredClone(src.assets[assetId])
    }
  }
  doc.nodes[newId] = clone
  doc.featureOrder.push(newId)
  return newId
}

export interface CadState {
  doc: CadDocument
  selectedIds: NodeId[]
  /** The selected construction plane, if any. Mutually exclusive with node selection. */
  selectedPlaneId: string | null
  past: CadDocument[]
  future: CadDocument[]
  /** Running counter used to name new nodes. Not part of history. */
  counter: number
  /** Display name of the current document; drives save/export filenames. */
  documentName: string
  /** Whether there are unsaved changes since the last save / new / open. */
  dirty: boolean
  /** In-app clipboard for copy/paste (not part of the document or undo). */
  clipboard: ClipboardData | null

  // selection
  select: (ids: NodeId[]) => void
  toggleSelect: (id: NodeId) => void
  clearSelection: () => void
  /** Select a construction plane (clears node selection); null to deselect. */
  selectPlane: (id: string | null) => void

  // construction planes (datums — reference geometry, not solids)
  addPlane: (definition: PlaneDefinition, name?: string) => string
  renamePlane: (id: string, name: string) => void
  setPlaneVisible: (id: string, visible: boolean) => void
  setPlaneDefinition: (id: string, definition: PlaneDefinition) => void
  deletePlane: (id: string) => void

  // creation / structure
  addPrimitive: (type: PrimitiveType) => NodeId
  addExtrusion: (
    profile: Vec2[][],
    height: number,
    transform: Transform,
    flip?: boolean,
    sketch?: SketchSource,
    combine?: CombineTarget,
  ) => NodeId | null
  addRevolution: (
    profile: Vec2[][],
    degrees: number,
    segments: number,
    transform: Transform,
    sketch?: SketchSource,
    combine?: CombineTarget,
  ) => NodeId | null
  addMeshAsset: (name: string, position: Float32Array, index: Uint32Array) => NodeId
  /** Create an extruded-text solid from a pre-tessellated glyph profile. */
  addText: (text: string, size: number, height: number, profile: Vec2[][]) => NodeId | null
  group: (ids: NodeId[]) => NodeId | null
  ungroup: (id: NodeId) => void
  applyBoolean: (ids: NodeId[], op: BooleanOp) => NodeId | null
  /** Wrap the selected root object(s) in a linear/circular/mirror pattern. */
  patternNodes: (ids: NodeId[], spec: PatternSpec) => NodeId | null
  /** Wrap the selected root object(s) in a hollow shell of the given wall. */
  shellNodes: (ids: NodeId[], thickness: number, openTop: boolean) => NodeId | null
  /** Wrap the selected root object(s) in an (initially empty) edge chamfer/fillet. */
  edgeTreatmentNodes: (ids: NodeId[]) => NodeId | null
  /** Add a picked edge to an edgeTreatment node. */
  addEdgeEntry: (id: NodeId, entry: Omit<EdgeTreatmentEntry, 'id'>) => void
  /** Update one entry's kind/size. */
  updateEdgeEntry: (
    id: NodeId,
    entryId: string,
    patch: Partial<Pick<EdgeTreatmentEntry, 'kind' | 'size'>>,
  ) => void
  removeEdgeEntry: (id: NodeId, entryId: string) => void
  deleteNodes: (ids: NodeId[]) => void
  /** Deep-copy the selected subtree(s) as siblings, nudged + selected. */
  duplicateNodes: (ids: NodeId[]) => NodeId[]
  /** Reorder/reparent dragged nodes relative to a target (preserves world pose). */
  moveNodes: (ids: NodeId[], targetId: NodeId, position: DropPosition) => void
  /** Snapshot the selected subtree(s) into the in-app clipboard. */
  copyNodes: (ids: NodeId[]) => void
  /** Paste the clipboard as new root nodes, nudged + selected. */
  pasteClipboard: () => NodeId[]
  /** Hide every root except the ones containing the given nodes. */
  isolateNodes: (ids: NodeId[]) => void
  /** Make every root node visible again. */
  showAllNodes: () => void

  // node edits
  transformNode: (id: NodeId, transform: Transform) => void
  /**
   * Like `transformNode`, but for a leaf primitive it folds a bakeable scale
   * into the primitive's params (resetting the scale to identity) so the
   * parametric dimensions stay the source of truth. Use this for user-driven
   * transform edits (gizmo, property editor); use `transformNode` for internal
   * world-pose-preserving moves that must keep the raw scale.
   */
  setNodeTransform: (id: NodeId, transform: Transform) => void
  setNodeParams: (id: NodeId, params: PrimitiveParams) => void
  /** Replace a pattern node's replication spec. */
  setPatternSpec: (id: NodeId, spec: PatternSpec) => void
  /** Update a shell node's wall thickness / open-top flag. */
  setShellParams: (id: NodeId, thickness: number, openTop: boolean) => void
  setRole: (id: NodeId, role: Role) => void
  setNodeName: (id: NodeId, name: string) => void
  setNodeColor: (id: NodeId, color: string) => void
  setNodeVisible: (id: NodeId, visible: boolean) => void
  /** Update a sketch-based solid's profile + editable source (re-edit). */
  setNodeSketch: (id: NodeId, profile: Vec2[][], sketch: SketchSource) => void

  // document
  loadDocument: (doc: CadDocument, name?: string) => void
  newDocument: () => void
  setDocumentName: (name: string) => void
  /** Mark the document as saved (clears the dirty flag). */
  markSaved: () => void

  // live editing — coalesce a scrub gesture (e.g. mouse-wheel on a property
  // field) into a single undo step. Bracket the gesture with these; the
  // mutations in between collapse to one history entry.
  /** Start a live-edit gesture: subsequent mutations coalesce into one undo step. */
  beginLiveEdit: () => void
  /** End a live-edit gesture started with beginLiveEdit. */
  endLiveEdit: () => void

  // history
  undo: () => void
  redo: () => void
}

export const useCadStore = create<CadState>()((set, get) => {
  // Live-edit gesture state (transient; not part of the document or history).
  // While a gesture is active (e.g. scrubbing a property field with the mouse
  // wheel), every mutation coalesces into a single undo step: the pre-edit doc
  // is snapshotted onto `past` once, then the working doc is replaced in place.
  let liveActive = false
  let liveBaselinePushed = false

  /** Apply an immer recipe to the document and record an undo step. */
  const mutate = (recipe: (doc: CadDocument) => void) => {
    set((state) => {
      const doc = produce(state.doc, recipe)
      if (doc === state.doc) return {}
      if (liveActive) {
        // First change of the gesture snapshots history; the rest don't grow it.
        if (liveBaselinePushed) return { doc, future: [], dirty: true }
        liveBaselinePushed = true
        return {
          doc,
          past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
          future: [],
          dirty: true,
        }
      }
      return {
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      }
    })
  }

  const beginLiveEdit = () => {
    if (liveActive) return
    liveActive = true
    liveBaselinePushed = false
  }
  const endLiveEdit = () => {
    liveActive = false
    liveBaselinePushed = false
  }

  const nextName = (base: string): string => {
    const n = get().counter + 1
    set({ counter: n })
    return `${base} ${n}`
  }

  const makeContainer = (
    ids: NodeId[],
    build: (id: NodeId, childIds: NodeId[]) => CadNode,
    preserveOrder: boolean,
  ): NodeId | null => {
    const id = nanoid()
    let created: NodeId | null = null
    mutate((doc) => {
      const rootChildren = ids.filter((cid) => doc.rootIds.includes(cid))
      if (rootChildren.length < 2) return
      const orderedRoots = doc.rootIds.filter((rid) => rootChildren.includes(rid))
      const childIds = preserveOrder ? rootChildren : orderedRoots
      const firstIdx = doc.rootIds.indexOf(orderedRoots[0])
      doc.nodes[id] = build(id, childIds)
      doc.rootIds = doc.rootIds.filter((rid) => !rootChildren.includes(rid))
      doc.rootIds.splice(firstIdx, 0, id)
      doc.featureOrder.push(id)
      created = id
    })
    if (created) get().select([created])
    return created
  }

  /**
   * Wrap the selected object(s) — resolved to their top-level roots — in a single
   * new container (pattern/shell), inserted where the first root was. The roots
   * keep their world pose (the container is identity), so the modifier just adds
   * a derivation on top. Unlike `makeContainer`, one root is enough.
   */
  const wrapRoots = (
    ids: NodeId[],
    build: (id: NodeId, childIds: NodeId[]) => CadNode,
  ): NodeId | null => {
    const id = nanoid()
    let created: NodeId | null = null
    mutate((doc) => {
      const roots = [...new Set(ids.map((nid) => rootOf(doc, nid)))].filter((rid) => doc.nodes[rid])
      const ordered = doc.rootIds.filter((rid) => roots.includes(rid))
      if (ordered.length === 0) return
      const firstIdx = doc.rootIds.indexOf(ordered[0])
      doc.nodes[id] = build(id, ordered)
      doc.rootIds = doc.rootIds.filter((rid) => !roots.includes(rid))
      doc.rootIds.splice(firstIdx, 0, id)
      doc.featureOrder.push(id)
      created = id
    })
    if (created) get().select([created])
    return created
  }

  return {
    doc: createEmptyDocument(),
    selectedIds: [],
    selectedPlaneId: null,
    past: [],
    future: [],
    counter: 0,
    documentName: 'Untitled',
    dirty: false,
    clipboard: null,

    select: (ids) => set({ selectedIds: ids, selectedPlaneId: null }),
    toggleSelect: (id) =>
      set((state) => ({
        selectedPlaneId: null,
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((s) => s !== id)
          : [...state.selectedIds, id],
      })),
    clearSelection: () => set({ selectedIds: [], selectedPlaneId: null }),
    selectPlane: (id) => set({ selectedPlaneId: id, selectedIds: [] }),

    addPlane: (definition, name) => {
      const id = nanoid()
      const planeName = name ?? nextName('Plane')
      mutate((doc) => {
        doc.planes[id] = { id, name: planeName, visible: true, definition }
        doc.planeOrder.push(id)
      })
      set({ selectedPlaneId: id, selectedIds: [] })
      return id
    },
    renamePlane: (id, name) =>
      mutate((doc) => {
        const p = doc.planes[id]
        if (p) p.name = name
      }),
    setPlaneVisible: (id, visible) =>
      mutate((doc) => {
        const p = doc.planes[id]
        if (p) p.visible = visible
      }),
    setPlaneDefinition: (id, definition) =>
      mutate((doc) => {
        const p = doc.planes[id]
        if (p) p.definition = definition
      }),
    deletePlane: (id) => {
      mutate((doc) => {
        delete doc.planes[id]
        doc.planeOrder = doc.planeOrder.filter((p) => p !== id)
      })
      set((state) => ({
        selectedPlaneId: state.selectedPlaneId === id ? null : state.selectedPlaneId,
      }))
    },

    addPrimitive: (type) => {
      const id = nanoid()
      const params = defaultParams(type)
      const name = nextName(TYPE_LABEL[type])
      const color = PALETTE[get().counter % PALETTE.length]
      mutate((doc) => {
        const offset = doc.rootIds.length * 4
        doc.nodes[id] = {
          id,
          kind: 'primitive',
          name,
          params,
          color,
          visible: true,
          role: 'solid',
          transform: {
            position: [offset, offset, restingZ(params)],
            rotationDeg: [0, 0, 0],
            scale: [1, 1, 1],
          },
        }
        doc.rootIds.push(id)
        doc.featureOrder.push(id)
      })
      get().select([id])
      return id
    },

    addExtrusion: (profile, height, transform, flip = false, sketch, combine) => {
      // The profile arrives recentered in plane-local space; `transform` places
      // that plane in the world (and applies the in-plane offset). The extrusion
      // grows along the plane normal (engine builds it 0..height on +local-Z, or
      // -Z when flipped). When `combine` is set (the sketch was drawn on an
      // existing object's face) the new solid is folded into that object via a
      // boolean — all in one undo step.
      const contours = cleanContours(profile)
      if (contours.length === 0 || height <= 0) return null
      const id = nanoid()
      const name = nextName(TYPE_LABEL.extrusion)
      const color = PALETTE[get().counter % PALETTE.length]
      const boolName = combine ? nextName(combineLabel(combine.op)) : ''
      let resultId: NodeId = id
      mutate((doc) => {
        doc.nodes[id] = {
          id,
          kind: 'primitive',
          name,
          params: { type: 'extrusion', profile: contours, height, flip, sketch },
          color,
          visible: true,
          role: 'solid',
          transform,
        }
        doc.rootIds.push(id)
        doc.featureOrder.push(id)
        if (combine) {
          const bid = wrapInBoolean(doc, combine.targetId, id, combine.op, boolName)
          if (bid) resultId = bid
        }
      })
      get().select([resultId])
      return resultId
    },

    addRevolution: (profile, degrees, segments, transform, sketch, combine) => {
      const contours = cleanContours(profile)
      if (contours.length === 0 || degrees <= 0) return null
      const id = nanoid()
      const name = nextName(TYPE_LABEL.revolution)
      const color = PALETTE[get().counter % PALETTE.length]
      const boolName = combine ? nextName(combineLabel(combine.op)) : ''
      let resultId: NodeId = id
      mutate((doc) => {
        doc.nodes[id] = {
          id,
          kind: 'primitive',
          name,
          params: { type: 'revolution', profile: contours, degrees, segments, sketch },
          color,
          visible: true,
          role: 'solid',
          transform,
        }
        doc.rootIds.push(id)
        doc.featureOrder.push(id)
        if (combine) {
          const bid = wrapInBoolean(doc, combine.targetId, id, combine.op, boolName)
          if (bid) resultId = bid
        }
      })
      get().select([resultId])
      return resultId
    },

    addMeshAsset: (name, position, index) => {
      const id = nanoid()
      const assetId = nanoid()
      const displayName = nextName(name)
      const color = PALETTE[get().counter % PALETTE.length]
      mutate((doc) => {
        doc.assets[assetId] = { position, index }
        doc.nodes[id] = {
          id,
          kind: 'primitive',
          name: displayName,
          params: { type: 'mesh', assetId },
          color,
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
        }
        doc.rootIds.push(id)
        doc.featureOrder.push(id)
      })
      get().select([id])
      return id
    },

    addText: (text, size, height, profile) => {
      if (profile.length === 0 || height <= 0) return null
      const id = nanoid()
      const name = nextName(TYPE_LABEL.text)
      const color = PALETTE[get().counter % PALETTE.length]
      mutate((doc) => {
        const offset = doc.rootIds.length * 4
        doc.nodes[id] = {
          id,
          kind: 'primitive',
          name,
          params: { type: 'text', text, size, height, profile },
          color,
          visible: true,
          role: 'solid',
          transform: { position: [offset, offset, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
        }
        doc.rootIds.push(id)
        doc.featureOrder.push(id)
      })
      get().select([id])
      return id
    },

    group: (ids) => {
      const name = nextName('Group')
      const color = PALETTE[get().counter % PALETTE.length]
      return makeContainer(
        ids,
        (id, childIds) => ({
          id,
          kind: 'group',
          name,
          childIds,
          color,
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
        }),
        false,
      )
    },

    applyBoolean: (ids, op) => {
      const name = nextName(combineLabel(op))
      const color = PALETTE[get().counter % PALETTE.length]
      return makeContainer(
        ids,
        (id, childIds) => ({
          id,
          kind: 'boolean',
          op,
          name,
          childIds,
          color,
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
        }),
        true,
      )
    },

    patternNodes: (ids, spec) => {
      const name = nextName(PATTERN_LABEL[spec.mode])
      const color = PALETTE[get().counter % PALETTE.length]
      return wrapRoots(ids, (id, childIds) => ({
        id,
        kind: 'pattern',
        name,
        spec,
        childIds,
        color,
        visible: true,
        role: 'solid',
        transform: { ...IDENTITY_TRANSFORM },
      }))
    },

    shellNodes: (ids, thickness, openTop) => {
      const name = nextName('Shell')
      const color = PALETTE[get().counter % PALETTE.length]
      return wrapRoots(ids, (id, childIds) => ({
        id,
        kind: 'shell',
        name,
        thickness,
        openTop,
        childIds,
        color,
        visible: true,
        role: 'solid',
        transform: { ...IDENTITY_TRANSFORM },
      }))
    },

    edgeTreatmentNodes: (ids) => {
      const name = nextName('Chamfer/Fillet')
      const color = PALETTE[get().counter % PALETTE.length]
      return wrapRoots(ids, (id, childIds) => ({
        id,
        kind: 'edgeTreatment',
        name,
        entries: [],
        childIds,
        color,
        visible: true,
        role: 'solid',
        transform: { ...IDENTITY_TRANSFORM },
      }))
    },

    addEdgeEntry: (id, entry) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node?.kind !== 'edgeTreatment') return
        node.entries.push({ ...entry, id: nanoid(8) })
      }),

    updateEdgeEntry: (id, entryId, patch) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node?.kind !== 'edgeTreatment') return
        const entry = node.entries.find((e) => e.id === entryId)
        if (!entry) return
        if (patch.kind !== undefined) entry.kind = patch.kind
        if (patch.size !== undefined) entry.size = Math.max(0.05, patch.size)
      }),

    removeEdgeEntry: (id, entryId) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node?.kind !== 'edgeTreatment') return
        node.entries = node.entries.filter((e) => e.id !== entryId)
      }),

    ungroup: (id) => {
      let promoted: NodeId[] = []
      mutate((doc) => {
        const node = doc.nodes[id]
        if (!node || !hasChildren(node)) return
        const idx = doc.rootIds.indexOf(id)
        if (idx === -1) return
        for (const cid of node.childIds) {
          const child = doc.nodes[cid]
          if (!child) continue
          child.transform = composeTransforms(node.transform, child.transform)
          child.role = 'solid'
        }
        promoted = [...node.childIds]
        doc.rootIds.splice(idx, 1, ...node.childIds)
        delete doc.nodes[id]
      })
      if (promoted.length) get().select(promoted)
    },

    deleteNodes: (ids) => {
      mutate((doc) => {
        const toDelete = new Set<NodeId>()
        ids.forEach((id) => collectSubtree(doc, id, toDelete))
        toDelete.forEach((id) => delete doc.nodes[id])
        doc.rootIds = doc.rootIds.filter((id) => !toDelete.has(id))
        for (const node of Object.values(doc.nodes)) {
          if (hasChildren(node)) node.childIds = node.childIds.filter((c) => !toDelete.has(c))
        }
        cleanupEmptyContainers(doc)
      })
      set((state) => ({ selectedIds: state.selectedIds.filter((id) => state.doc.nodes[id]) }))
    },

    duplicateNodes: (ids) => {
      // Source must be the live (non-draft) doc so structuredClone is safe.
      const srcDoc = get().doc
      const tops = topLevelOf(srcDoc, [...new Set(ids)])
      if (tops.length === 0) return []
      const created: NodeId[] = []
      mutate((doc) => {
        for (const id of tops) {
          const newId = cloneSubtree(srcDoc, doc, id)
          if (!newId) continue
          const arr = parentArray(doc, id)
          if (arr) arr.splice(arr.indexOf(id) + 1, 0, newId)
          else doc.rootIds.push(newId)
          const node = doc.nodes[newId]
          const p = node.transform.position
          node.transform = {
            ...node.transform,
            position: [p[0] + DUP_OFFSET, p[1] + DUP_OFFSET, p[2]],
          }
          created.push(newId)
        }
      })
      if (created.length) get().select(created)
      return created
    },

    moveNodes: (ids, targetId, position) => {
      mutate((doc) => {
        if (!doc.nodes[targetId]) return
        const moving = topLevelOf(doc, [...new Set(ids)]).filter((id) => id !== targetId)
        if (moving.length === 0) return
        // Never drop a node into its own subtree.
        for (const id of moving) {
          const sub = new Set<NodeId>()
          collectSubtree(doc, id, sub)
          if (sub.has(targetId)) return
        }
        const target = doc.nodes[targetId]
        let destArray: NodeId[]
        let destParentId: NodeId | null
        if (position === 'inside') {
          if (!hasChildren(target)) return
          destArray = target.childIds
          destParentId = targetId
        } else {
          destArray = parentArray(doc, targetId) ?? doc.rootIds
          destParentId = parentNodeId(doc, targetId)
        }
        // Compute new local transforms (preserving world pose) before any moves.
        const newLocals = new Map<NodeId, Transform>()
        for (const id of moving) newLocals.set(id, localTransformUnder(doc, id, destParentId))
        // Detach from current parents.
        for (const id of moving) {
          const arr = parentArray(doc, id)
          if (arr) {
            const i = arr.indexOf(id)
            if (i >= 0) arr.splice(i, 1)
          }
        }
        // Insert (target index may have shifted after detaching).
        let insertAt: number
        if (position === 'inside') insertAt = destArray.length
        else {
          const ti = destArray.indexOf(targetId)
          insertAt = ti < 0 ? destArray.length : position === 'before' ? ti : ti + 1
        }
        destArray.splice(insertAt, 0, ...moving)
        for (const id of moving) {
          const n = doc.nodes[id]
          n.transform = newLocals.get(id)!
          if (destParentId === null) n.role = 'solid' // role only applies inside a group
        }
        cleanupEmptyContainers(doc)
      })
      set((state) => ({ selectedIds: state.selectedIds.filter((id) => state.doc.nodes[id]) }))
    },

    copyNodes: (ids) => {
      const doc = get().doc
      const tops = topLevelOf(doc, [...new Set(ids)])
      if (tops.length === 0) {
        set({ clipboard: null })
        return
      }
      const sub = new Set<NodeId>()
      tops.forEach((id) => collectSubtree(doc, id, sub))
      const nodes: Record<NodeId, CadNode> = {}
      const assets: Record<string, MeshAsset> = {}
      sub.forEach((id) => {
        const n = doc.nodes[id]
        if (!n) return
        nodes[id] = structuredClone(n)
        if (n.kind === 'primitive' && n.params.type === 'mesh') {
          const a = doc.assets[n.params.assetId]
          if (a) assets[n.params.assetId] = structuredClone(a)
        }
      })
      set({ clipboard: { nodes, rootIds: tops, assets } })
    },

    pasteClipboard: () => {
      const clip = get().clipboard
      if (!clip || clip.rootIds.length === 0) return []
      const created: NodeId[] = []
      mutate((doc) => {
        for (const id of clip.rootIds) {
          const newId = cloneSubtree(clip, doc, id)
          if (!newId) continue
          doc.rootIds.push(newId)
          const node = doc.nodes[newId]
          const p = node.transform.position
          node.transform = {
            ...node.transform,
            position: [p[0] + DUP_OFFSET, p[1] + DUP_OFFSET, p[2]],
          }
          node.role = 'solid' // pasted at root: role only applies inside a group
          created.push(newId)
        }
      })
      if (created.length) get().select(created)
      return created
    },

    isolateNodes: (ids) =>
      mutate((doc) => {
        const keep = new Set(ids.map((id) => rootOf(doc, id)))
        for (const rid of doc.rootIds) {
          const n = doc.nodes[rid]
          if (n) n.visible = keep.has(rid)
        }
      }),

    showAllNodes: () =>
      mutate((doc) => {
        for (const rid of doc.rootIds) {
          const n = doc.nodes[rid]
          if (n) n.visible = true
        }
      }),

    transformNode: (id, transform) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node) node.transform = transform
      }),

    setNodeTransform: (id, transform) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (!node) return
        if (node.kind === 'primitive') {
          const baked = bakeScaleIntoParams(node.params, transform.scale)
          if (baked) {
            node.params = baked.params
            node.transform = { ...transform, scale: baked.residualScale }
            return
          }
        }
        node.transform = transform
      }),

    setNodeParams: (id, params) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node && node.kind === 'primitive') node.params = params
      }),

    setPatternSpec: (id, spec) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node && node.kind === 'pattern') node.spec = spec
      }),

    setShellParams: (id, thickness, openTop) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node && node.kind === 'shell') {
          node.thickness = thickness
          node.openTop = openTop
        }
      }),

    setRole: (id, role) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node) node.role = role
      }),

    setNodeName: (id, name) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node) node.name = name
      }),

    setNodeColor: (id, color) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node) node.color = color
      }),

    setNodeVisible: (id, visible) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node) node.visible = visible
      }),

    setNodeSketch: (id, profile, sketch) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (!node || node.kind !== 'primitive') return
        const cleaned = cleanContours(profile)
        if (node.params.type === 'extrusion') {
          node.params = { ...node.params, profile: cleaned, sketch }
        } else if (node.params.type === 'revolution') {
          node.params = { ...node.params, profile: cleaned, sketch }
        }
      }),

    loadDocument: (doc, name = 'Untitled') =>
      set({
        doc,
        past: [],
        future: [],
        selectedIds: [],
        selectedPlaneId: null,
        counter: 0,
        documentName: name,
        dirty: false,
      }),
    newDocument: () =>
      set({
        doc: createEmptyDocument(),
        past: [],
        future: [],
        selectedIds: [],
        selectedPlaneId: null,
        counter: 0,
        documentName: 'Untitled',
        dirty: false,
      }),
    setDocumentName: (documentName) => set({ documentName }),
    markSaved: () => set({ dirty: false }),

    beginLiveEdit,
    endLiveEdit,

    undo: () =>
      set((state) => {
        if (state.past.length === 0) return {}
        const previous = state.past[state.past.length - 1]
        return {
          doc: previous,
          past: state.past.slice(0, -1),
          future: [state.doc, ...state.future],
          selectedIds: state.selectedIds.filter((id) => previous.nodes[id]),
          selectedPlaneId:
            state.selectedPlaneId && previous.planes[state.selectedPlaneId]
              ? state.selectedPlaneId
              : null,
          dirty: true,
        }
      }),

    redo: () =>
      set((state) => {
        if (state.future.length === 0) return {}
        const next = state.future[0]
        return {
          doc: next,
          past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
          future: state.future.slice(1),
          selectedIds: state.selectedIds.filter((id) => next.nodes[id]),
          selectedPlaneId:
            state.selectedPlaneId && next.planes[state.selectedPlaneId]
              ? state.selectedPlaneId
              : null,
          dirty: true,
        }
      }),
  }
})
