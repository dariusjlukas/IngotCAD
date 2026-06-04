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
  NodeId,
  PrimitiveParams,
  PrimitiveType,
  Role,
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

export interface CadState {
  doc: CadDocument
  selectedIds: NodeId[]
  past: CadDocument[]
  future: CadDocument[]
  /** Running counter used to name new nodes. Not part of history. */
  counter: number

  // selection
  select: (ids: NodeId[]) => void
  toggleSelect: (id: NodeId) => void
  clearSelection: () => void

  // creation / structure
  addPrimitive: (type: PrimitiveType) => NodeId
  addExtrusion: (profile: Vec2[][], height: number, transform: Transform, flip?: boolean) => NodeId | null
  addRevolution: (
    profile: Vec2[][],
    degrees: number,
    segments: number,
    transform: Transform,
  ) => NodeId | null
  addMeshAsset: (name: string, position: Float32Array, index: Uint32Array) => NodeId
  group: (ids: NodeId[]) => NodeId | null
  ungroup: (id: NodeId) => void
  applyBoolean: (ids: NodeId[], op: BooleanOp) => NodeId | null
  deleteNodes: (ids: NodeId[]) => void

  // node edits
  transformNode: (id: NodeId, transform: Transform) => void
  setNodeParams: (id: NodeId, params: PrimitiveParams) => void
  setRole: (id: NodeId, role: Role) => void
  setNodeName: (id: NodeId, name: string) => void
  setNodeColor: (id: NodeId, color: string) => void
  setNodeVisible: (id: NodeId, visible: boolean) => void

  // document
  loadDocument: (doc: CadDocument) => void
  newDocument: () => void

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
      })
      get().select([id])
      return id
    },

    addExtrusion: (profile, height, transform, flip = false) => {
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
          params: { type: 'extrusion', profile: contours, height, flip },
          color,
          visible: true,
          role: 'solid',
          transform,
        }
        doc.rootIds.push(id)
      })
      get().select([id])
      return id
    },

    addRevolution: (profile, degrees, segments, transform) => {
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
          params: { type: 'revolution', profile: contours, degrees, segments },
          color,
          visible: true,
          role: 'solid',
          transform,
        }
        doc.rootIds.push(id)
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

    loadDocument: (doc) => set({ doc, past: [], future: [], selectedIds: [], counter: 0 }),
    newDocument: () =>
      set({ doc: createEmptyDocument(), past: [], future: [], selectedIds: [], counter: 0 }),

    undo: () =>
      set((state) => {
        if (state.past.length === 0) return {}
        const previous = state.past[state.past.length - 1]
        return {
          doc: previous,
          past: state.past.slice(0, -1),
          future: [state.doc, ...state.future],
          selectedIds: state.selectedIds.filter((id) => previous.nodes[id]),
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
        }
      }),
  }
})
