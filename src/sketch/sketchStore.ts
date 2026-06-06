/** Sketch-mode state: a constraint-based sketch + selection + view + extrude height. */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { NodeId, SketchSource, Vec2, Vec3 } from '../document/types'
import { useOperationStore } from '../operation/operationStore'
import { useCadStore } from '../document/store'
import type { ConstraintId, ConstraintInput, PointId, ShapeId, SketchData, SPoint } from './model'
import { emptySketch, removeShapeFromData, shapeContours, shapeIdOfPoint } from './model'
import { solve } from './solver'
import type { PlaneKind, SketchPlane } from './plane'
import { cardinalPlane, planeFromFace, planeToTransform } from './plane'

const CARDINAL_LABEL: Record<PlaneKind, string> = { xy: 'Top', xz: 'Front', yz: 'Right' }

/** Drawing tools. `null` means Select mode (the absence of a tool). */
export type SketchTool = 'line' | 'rectangle' | 'circle' | 'dimension' | 'project'

export interface View {
  cx: number
  cy: number
  size: number
}
const DEFAULT_VIEW: View = { cx: 0, cy: 0, size: 240 }

export type Ref =
  | { t: 'point'; id: PointId }
  | { t: 'segment'; a: PointId; b: PointId }
  | { t: 'circle'; id: ShapeId }
  | { t: 'constraint'; id: ConstraintId }

const id = () => nanoid(8)

function cloneData(d: SketchData): SketchData {
  const points: Record<PointId, SPoint> = {}
  for (const [k, p] of Object.entries(d.points)) points[k] = { ...p }
  return {
    points,
    shapes: d.shapes.map((s) => (s.kind === 'loop' ? { ...s, pts: [...s.pts] } : { ...s })),
    constraints: d.constraints.map((c) => ({ ...c })),
  }
}

interface SketchState {
  active: boolean
  /** True while the user is picking a plane/face before the canvas opens. */
  choosing: boolean
  plane: SketchPlane | null
  planeLabel: string
  /** When set, committing updates this existing node's sketch instead of creating one. */
  editingNodeId: NodeId | null
  /** The object whose face the plane was picked from (null for cardinal/datum planes). */
  sourceNodeId: NodeId | null
  tool: SketchTool | null
  data: SketchData
  selection: Ref[]
  view: View
  /** When true, newly created geometry is construction (reference-only). */
  construction: boolean
  /** What the profile becomes on commit (the value is chosen afterward in preview). */
  outputMode: 'extrude' | 'revolve'

  /** Start a new sketch: enter plane-selection. */
  open: () => void
  /** Re-open the sketch of an existing extrusion/revolution node for editing. */
  editSketch: (nodeId: NodeId) => void
  chooseCardinal: (kind: PlaneKind) => void
  /** `sourceNodeId` is the picked object, enabling union/subtract on commit. */
  chooseFace: (point: Vec3, normal: Vec3, sourceNodeId?: NodeId) => void
  /** Start sketching on an already-resolved construction plane. */
  chooseConstructionPlane: (plane: SketchPlane, label: string) => void
  cancel: () => void
  setTool: (tool: SketchTool | null) => void
  setView: (view: View) => void
  fitView: () => void
  setConstruction: (construction: boolean) => void
  /** Flip the construction flag of every shape touched by the selection. */
  toggleConstructionSelected: () => void
  setOutputMode: (mode: 'extrude' | 'revolve') => void

  addRectangle: (x: number, y: number, w: number, h: number) => void
  addCircle: (cx: number, cy: number, r: number) => void
  /** Create a closed loop; entries with `coincident` get tied to an existing point. */
  addLoop: (entries: { pos: Vec2; coincident?: PointId }[]) => void
  /** Include a sectioned geometry's outline (one or more loops) as anchored geometry. */
  addProjectedLoops: (polys: Vec2[][]) => void

  addConstraint: (input: ConstraintInput) => ConstraintId
  addDistance: (a: PointId, b: PointId, value: number, offset: number) => ConstraintId
  setDistanceValue: (cid: ConstraintId, value: number) => void
  setCircleRadius: (shapeId: ShapeId, r: number) => void
  setPointPos: (pid: PointId, x: number, y: number) => void
  togglePointFixed: (ids: PointId[]) => void

  dragPoint: (pid: PointId, x: number, y: number) => void

  select: (refs: Ref[]) => void
  clearSelection: () => void
  deleteSelection: () => void

  commit: () => void
}

export const useSketchStore = create<SketchState>((set, get) => {
  const update = (fn: (d: SketchData) => void, pinned?: Set<PointId>) => {
    const data = cloneData(get().data)
    fn(data)
    solve(data, pinned)
    set({ data })
  }

  return {
    active: false,
    choosing: false,
    plane: null,
    planeLabel: '',
    editingNodeId: null,
    sourceNodeId: null,
    tool: 'line',
    data: emptySketch(),
    selection: [],
    view: DEFAULT_VIEW,
    construction: false,
    outputMode: 'extrude',

    open: () =>
      set({
        choosing: true,
        active: false,
        plane: null,
        planeLabel: '',
        editingNodeId: null,
        sourceNodeId: null,
        data: emptySketch(),
        selection: [],
        tool: 'line',
        view: DEFAULT_VIEW,
        construction: false,
        outputMode: 'extrude',
      }),
    editSketch: (nodeId) => {
      const node = useCadStore.getState().doc.nodes[nodeId]
      if (!node || node.kind !== 'primitive') return
      const p = node.params
      if ((p.type !== 'extrusion' && p.type !== 'revolution') || !p.sketch) return
      set({
        active: true,
        choosing: false,
        editingNodeId: nodeId,
        sourceNodeId: null,
        plane: p.sketch.plane,
        planeLabel: 'Edit',
        data: cloneData(p.sketch.data),
        selection: [],
        tool: null,
        view: DEFAULT_VIEW,
        construction: false,
        outputMode: p.type === 'extrusion' ? 'extrude' : 'revolve',
      })
      get().fitView()
    },
    chooseCardinal: (kind) =>
      set({
        plane: cardinalPlane(kind),
        planeLabel: CARDINAL_LABEL[kind],
        choosing: false,
        active: true,
        sourceNodeId: null,
      }),
    chooseFace: (point, normal, sourceNodeId) =>
      set({
        plane: planeFromFace(point, normal),
        planeLabel: 'Face',
        choosing: false,
        active: true,
        sourceNodeId: sourceNodeId ?? null,
      }),
    chooseConstructionPlane: (plane, label) =>
      set({ plane, planeLabel: label, choosing: false, active: true, sourceNodeId: null }),
    cancel: () =>
      set({
        active: false,
        choosing: false,
        plane: null,
        editingNodeId: null,
        sourceNodeId: null,
        data: emptySketch(),
        selection: [],
      }),
    setTool: (tool) => set({ tool, selection: tool === null ? get().selection : [] }),
    setView: (view) => set({ view }),
    setConstruction: (construction) => set({ construction }),
    setOutputMode: (outputMode) => set({ outputMode }),
    fitView: () =>
      set((s) => {
        const pts = Object.values(s.data.points)
        if (pts.length === 0) return { view: DEFAULT_VIEW }
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const p of pts) {
          minX = Math.min(minX, p.x)
          minY = Math.min(minY, p.y)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
        }
        const extent = Math.max(maxX - minX, maxY - minY, 10)
        return { view: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: extent * 1.4 } }
      }),

    addRectangle: (x, y, w, h) =>
      update((d) => {
        const p0 = id()
        const p1 = id()
        const p2 = id()
        const p3 = id()
        d.points[p0] = { x, y, fixed: false }
        d.points[p1] = { x: x + w, y, fixed: false }
        d.points[p2] = { x: x + w, y: y + h, fixed: false }
        d.points[p3] = { x, y: y + h, fixed: false }
        d.shapes.push({
          id: id(),
          kind: 'loop',
          pts: [p0, p1, p2, p3],
          ...(get().construction && { construction: true }),
        })
        d.constraints.push(
          { id: id(), kind: 'horizontal', a: p0, b: p1 },
          { id: id(), kind: 'horizontal', a: p3, b: p2 },
          { id: id(), kind: 'vertical', a: p0, b: p3 },
          { id: id(), kind: 'vertical', a: p1, b: p2 },
        )
      }),

    addCircle: (cx, cy, r) =>
      update((d) => {
        const c = id()
        d.points[c] = { x: cx, y: cy, fixed: false }
        d.shapes.push({
          id: id(),
          kind: 'circle',
          c,
          r,
          ...(get().construction && { construction: true }),
        })
      }),

    addLoop: (entries) =>
      update((d) => {
        const ids = entries.map((e) => {
          const pid = id()
          d.points[pid] = { x: e.pos[0], y: e.pos[1], fixed: false }
          return pid
        })
        d.shapes.push({
          id: id(),
          kind: 'loop',
          pts: ids,
          ...(get().construction && { construction: true }),
        })
        // Merge vertices snapped onto existing points via a coincident constraint.
        entries.forEach((e, i) => {
          if (e.coincident && d.points[e.coincident]) {
            d.constraints.push({ id: id(), kind: 'coincident', a: ids[i], b: e.coincident })
          }
        })
      }),

    addProjectedLoops: (polys) =>
      update((d) => {
        const isConstruction = get().construction
        for (const poly of polys) {
          // Drop a duplicate closing vertex if the outline repeats its first point.
          const last = poly.length - 1
          const verts =
            poly.length > 1 && poly[0][0] === poly[last][0] && poly[0][1] === poly[last][1]
              ? poly.slice(0, -1)
              : poly
          if (verts.length < 3) continue
          // Projected geometry is anchored (fixed) so it stays a faithful copy of
          // the source object; coordinates keep their full precision (not rounded).
          const ids = verts.map((v) => {
            const pid = id()
            d.points[pid] = { x: v[0], y: v[1], fixed: true }
            return pid
          })
          d.shapes.push({
            id: id(),
            kind: 'loop',
            pts: ids,
            ...(isConstruction && { construction: true }),
          })
        }
      }),

    addConstraint: (input) => {
      const cid = id()
      update((d) => {
        d.constraints.push({ ...input, id: cid } as SketchData['constraints'][number])
      })
      return cid
    },

    addDistance: (a, b, value, offset) => {
      const cid = id()
      update((d) => {
        d.constraints.push({ id: cid, kind: 'distance', a, b, value, offset })
      })
      return cid
    },

    setDistanceValue: (cid, value) =>
      update((d) => {
        const c = d.constraints.find((x) => x.id === cid)
        if (c && c.kind === 'distance') c.value = Math.max(0.01, value)
      }),

    setCircleRadius: (shapeId, r) =>
      update((d) => {
        const s = d.shapes.find((x) => x.id === shapeId)
        if (s && s.kind === 'circle') s.r = Math.max(0.05, r)
      }),

    setPointPos: (pid, x, y) =>
      update((d) => {
        const p = d.points[pid]
        if (p) {
          p.x = x
          p.y = y
        }
      }),

    togglePointFixed: (ids) =>
      update((d) => {
        for (const pid of ids) if (d.points[pid]) d.points[pid].fixed = !d.points[pid].fixed
      }),

    toggleConstructionSelected: () => {
      const refs = get().selection
      if (refs.length === 0) return
      update((d) => {
        const shapeIds = new Set<ShapeId>()
        for (const r of refs) {
          if (r.t === 'circle') shapeIds.add(r.id)
          else if (r.t === 'segment') {
            const sid = shapeIdOfPoint(d, r.a)
            if (sid) shapeIds.add(sid)
          } else if (r.t === 'point') {
            const sid = shapeIdOfPoint(d, r.id)
            if (sid) shapeIds.add(sid)
          }
        }
        for (const s of d.shapes) {
          if (!shapeIds.has(s.id)) continue
          if (s.construction) delete s.construction
          else s.construction = true
        }
      })
    },

    dragPoint: (pid, x, y) =>
      update(
        (d) => {
          const p = d.points[pid]
          if (p) {
            p.x = x
            p.y = y
          }
        },
        new Set([pid]),
      ),

    select: (refs) => set({ selection: refs }),
    clearSelection: () => set({ selection: [] }),

    deleteSelection: () => {
      const refs = get().selection
      if (refs.length === 0) return
      update((d) => {
        for (const r of refs) {
          if (r.t === 'constraint') {
            d.constraints = d.constraints.filter((c) => c.id !== r.id)
          } else {
            const shapeId =
              r.t === 'circle' ? r.id : shapeIdOfPoint(d, r.t === 'point' ? r.id : r.a)
            if (shapeId) removeShapeFromData(d, shapeId)
          }
        }
      })
      set({ selection: [] })
    },

    commit: () => {
      const s = get()
      const contours = shapeContours(s.data)
      if (contours.length === 0) return
      const plane = s.plane ?? cardinalPlane('xy')
      // The editable source stored on the solid (snapshot of the current sketch).
      const source: SketchSource = { data: cloneData(s.data), plane }

      // Editing an existing solid: update its profile + source in place, keeping
      // its current height/flip/angle. Everything downstream recomputes.
      if (s.editingNodeId) {
        useCadStore.getState().setNodeSketch(s.editingNodeId, contours, source)
        set({
          active: false,
          choosing: false,
          plane: null,
          editingNodeId: null,
          sourceNodeId: null,
          data: emptySketch(),
          selection: [],
        })
        return
      }

      // New solid: profile is used as-drawn (plane-local); the node transform is
      // the plane frame. Hand off to the live extrude/revolve preview, carrying
      // the source object (if any) so the user can union/subtract on confirm.
      const op = useOperationStore.getState()
      const transform = planeToTransform(plane)
      if (s.outputMode === 'revolve') {
        op.start({
          mode: 'revolve',
          profile: contours,
          transform,
          segments: 64,
          value: 360,
          flip: false,
          sketch: source,
          sourceNodeId: s.sourceNodeId,
        })
      } else {
        op.start({
          mode: 'extrude',
          profile: contours,
          transform,
          segments: 64,
          value: 10,
          flip: false,
          sketch: source,
          sourceNodeId: s.sourceNodeId,
        })
      }
      set({
        active: false,
        choosing: false,
        plane: null,
        editingNodeId: null,
        sourceNodeId: null,
        data: emptySketch(),
        selection: [],
      })
    },
  }
})
