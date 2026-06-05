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
  MeshAsset,
  NodeId,
  PrimitiveParams,
  PrimitiveType,
  Role,
  SketchSource,
  Transform,
  Vec2,
} from './types'
import { createEmptyDocument, hasChildren, IDENTITY_TRANSFORM } from './types'
import { transformToMatrix4, matrix4ToTransform } from '../geometry/transform'
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
function rootOf(doc: CadDocument, id: NodeId): NodeId {
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

  // creation / structure
  addPrimitive: (type: PrimitiveType) => NodeId
  addExtrusion: (
    profile: Vec2[][],
    height: number,
    transform: Transform,
    flip?: boolean,
    sketch?: SketchSource,
  ) => NodeId | null
  addRevolution: (
    profile: Vec2[][],
    degrees: number,
    segments: number,
    transform: Transform,
    sketch?: SketchSource,
  ) => NodeId | null
  addMeshAsset: (name: string, position: Float32Array, index: Uint32Array) => NodeId
  group: (ids: NodeId[]) => NodeId | null
  ungroup: (id: NodeId) => void
  applyBoolean: (ids: NodeId[], op: BooleanOp) => NodeId | null
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
  setNodeParams: (id: NodeId, params: PrimitiveParams) => void
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

  // history
  undo: () => void
  redo: () => void
}

export const useCadStore = create<CadState>()((set, get) => {
  /** Apply an immer recipe to the document and record an undo step. */
  const mutate = (recipe: (doc: CadDocument) => void) => {
    set((state) => {
      const doc = produce(state.doc, recipe)
      if (doc === state.doc) return {}
      return {
        doc,
        past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      }
    })
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

  return {
    doc: createEmptyDocument(),
    selectedIds: [],
    past: [],
    future: [],
    counter: 0,
    documentName: 'Untitled',
    dirty: false,
    clipboard: null,

    select: (ids) => set({ selectedIds: ids }),
    toggleSelect: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((s) => s !== id)
          : [...state.selectedIds, id],
      })),
    clearSelection: () => set({ selectedIds: [] }),

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

    addExtrusion: (profile, height, transform, flip = false, sketch) => {
      // The profile arrives recentered in plane-local space; `transform` places
      // that plane in the world (and applies the in-plane offset). The extrusion
      // grows along the plane normal (engine builds it 0..height on +local-Z, or
      // -Z when flipped).
      const contours = cleanContours(profile)
      if (contours.length === 0 || height <= 0) return null
      const id = nanoid()
      const name = nextName(TYPE_LABEL.extrusion)
      const color = PALETTE[get().counter % PALETTE.length]
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
      })
      get().select([id])
      return id
    },

    addRevolution: (profile, degrees, segments, transform, sketch) => {
      const contours = cleanContours(profile)
      if (contours.length === 0 || degrees <= 0) return null
      const id = nanoid()
      const name = nextName(TYPE_LABEL.revolution)
      const color = PALETTE[get().counter % PALETTE.length]
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
      })
      get().select([id])
      return id
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
      const labelBase = op === 'union' ? 'Union' : op === 'subtract' ? 'Difference' : 'Intersection'
      const name = nextName(labelBase)
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

    setNodeParams: (id, params) =>
      mutate((doc) => {
        const node = doc.nodes[id]
        if (node && node.kind === 'primitive') node.params = params
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
        counter: 0,
        documentName: 'Untitled',
        dirty: false,
      }),
    setDocumentName: (documentName) => set({ documentName }),
    markSaved: () => set({ dirty: false }),

    undo: () =>
      set((state) => {
        if (state.past.length === 0) return {}
        const previous = state.past[state.past.length - 1]
        return {
          doc: previous,
          past: state.past.slice(0, -1),
          future: [state.doc, ...state.future],
          selectedIds: state.selectedIds.filter((id) => previous.nodes[id]),
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
          dirty: true,
        }
      }),
  }
})
