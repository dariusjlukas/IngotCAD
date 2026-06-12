/** Sketch-mode state: a constraint-based sketch + selection + view + extrude height. */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type {
  CornerTreatment,
  FaceRef,
  NodeId,
  SegmentArc,
  SketchSource,
  Vec2,
  Vec3,
} from '../document/types'
import { useOperationStore } from '../operation/operationStore'
import { useCadStore } from '../document/store'
import type { ConstraintId, ConstraintInput, PointId, ShapeId, SketchData, SPoint } from './model'
import {
  canTreatCorner,
  constraintPoints,
  emptySketch,
  findLoopSegment,
  removeShapeFromData,
  shapeContours,
  shapeIdOfPoint,
} from './model'
import { solve } from './solver'
import type { PlaneKind, SketchPlane } from './plane'
import { cardinalPlane, planeFromFace, planeToTransform } from './plane'

const CARDINAL_LABEL: Record<PlaneKind, string> = { xy: 'Top', xz: 'Front', yz: 'Right' }

/** Drawing tools. `null` means Select mode (the absence of a tool). */
export type SketchTool =
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'arc'
  | 'dimension'
  | 'project'
  | 'fillet'
  | 'chamfer'

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

function cloneCorners(c: Record<PointId, CornerTreatment>): Record<PointId, CornerTreatment> {
  const out: Record<PointId, CornerTreatment> = {}
  for (const [k, v] of Object.entries(c)) out[k] = { ...v }
  return out
}

function cloneArcs(a: Record<PointId, SegmentArc>): Record<PointId, SegmentArc> {
  const out: Record<PointId, SegmentArc> = {}
  for (const [k, v] of Object.entries(a)) out[k] = { ...v }
  return out
}

function cloneData(d: SketchData): SketchData {
  const points: Record<PointId, SPoint> = {}
  for (const [k, p] of Object.entries(d.points)) points[k] = { ...p }
  return {
    points,
    shapes: d.shapes.map((s) =>
      s.kind === 'loop'
        ? {
            ...s,
            pts: [...s.pts],
            ...(s.corners && { corners: cloneCorners(s.corners) }),
            ...(s.arcs && { arcs: cloneArcs(s.arcs) }),
          }
        : { ...s },
    ),
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
  /** The picked face's local plane on that object (stale detection), if any. */
  faceRef: FaceRef | null
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
  chooseFace: (point: Vec3, normal: Vec3, sourceNodeId?: NodeId, faceRef?: FaceRef) => void
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
  /** Radius dimension on a circle (`shape`) or a loop arc (`a`/`b` endpoints + center `c`). */
  addRadiusDim: (
    target: { shape?: ShapeId; c: PointId; a?: PointId; b?: PointId },
    value: number,
    offset: number,
  ) => ConstraintId
  /** Angle dimension (degrees) between segments a–b and c–d. */
  addAngleDim: (
    a: PointId,
    b: PointId,
    c: PointId,
    d: PointId,
    value: number,
    offset: number,
  ) => ConstraintId
  /** Set the value of any dimension constraint (distance / radius / angle). */
  setDimensionValue: (cid: ConstraintId, value: number) => void
  /** Display a radius dimension as R (false) or ⌀ (true). */
  setDimensionDiameter: (cid: ConstraintId, diameter: boolean) => void
  setDistanceValue: (cid: ConstraintId, value: number) => void
  setCircleRadius: (shapeId: ShapeId, r: number) => void
  /**
   * Bow the loop segment between `a` and `b` into an arc through `center`
   * (replacing any existing arc on that segment, reusing its center point).
   * `ccw` is relative to the segment's LOOP order.
   */
  setSegmentArc: (a: PointId, b: PointId, center: Vec2, ccw: boolean) => void
  /** Flatten the arc on segment a–b back to a straight line. */
  removeSegmentArc: (a: PointId, b: PointId) => void
  /** Re-radius the arc on segment a–b by sliding its center along the chord's bisector. */
  setArcRadius: (a: PointId, b: PointId, r: number) => void
  setPointPos: (pid: PointId, x: number, y: number) => void
  togglePointFixed: (ids: PointId[]) => void
  /** Add/replace a fillet or chamfer on the loop corner at `pid`. */
  setCornerTreatment: (pid: PointId, kind: 'fillet' | 'chamfer', size: number) => void
  /** Remove any fillet/chamfer from the loop corner at `pid`. */
  removeCornerTreatment: (pid: PointId) => void

  dragPoint: (pid: PointId, x: number, y: number) => void

  select: (refs: Ref[]) => void
  clearSelection: () => void
  deleteSelection: () => void
  /**
   * Mirror the selected shapes across a sketch axis ('x' = the horizontal X axis,
   * flipping Y; 'y' = the vertical Y axis, flipping X), adding reflected copies.
   * The copies are independent free geometry (no symmetry constraint) — draw half,
   * mirror the rest.
   */
  mirrorSelection: (axis: 'x' | 'y') => void

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
    faceRef: null,
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
        faceRef: null,
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
        faceRef: p.sketch.faceRef ?? null,
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
        faceRef: null,
      }),
    chooseFace: (point, normal, sourceNodeId, faceRef) =>
      set({
        plane: planeFromFace(point, normal),
        planeLabel: 'Face',
        choosing: false,
        active: true,
        sourceNodeId: sourceNodeId ?? null,
        faceRef: faceRef ?? null,
      }),
    chooseConstructionPlane: (plane, label) =>
      set({
        plane,
        planeLabel: label,
        choosing: false,
        active: true,
        sourceNodeId: null,
        faceRef: null,
      }),
    cancel: () =>
      set({
        active: false,
        choosing: false,
        plane: null,
        editingNodeId: null,
        sourceNodeId: null,
        faceRef: null,
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

    addRadiusDim: (target, value, offset) => {
      const cid = id()
      update((d) => {
        d.constraints.push({
          id: cid,
          kind: 'radius',
          c: target.c,
          ...(target.shape && { shape: target.shape }),
          ...(target.a && { a: target.a }),
          ...(target.b && { b: target.b }),
          value: Math.max(0.05, value),
          offset,
        })
      })
      return cid
    },

    addAngleDim: (a, b, c, d, value, offset) => {
      const cid = id()
      update((data) => {
        data.constraints.push({ id: cid, kind: 'angle', a, b, c, d, value, offset })
      })
      return cid
    },

    setDimensionValue: (cid, value) =>
      update((d) => {
        const c = d.constraints.find((x) => x.id === cid)
        if (!c) return
        if (c.kind === 'distance') c.value = Math.max(0.01, value)
        else if (c.kind === 'radius') {
          // The edited value is the displayed one: a diameter dim edits 2r.
          const r = c.diameter ? value / 2 : value
          c.value = Math.max(0.05, r)
        } else if (c.kind === 'angle') c.value = Math.min(179.5, Math.max(0.5, value))
      }),

    setDimensionDiameter: (cid, diameter) =>
      update((d) => {
        const c = d.constraints.find((x) => x.id === cid)
        if (c && c.kind === 'radius') {
          if (diameter) c.diameter = true
          else delete c.diameter
        }
      }),

    setDistanceValue: (cid, value) => get().setDimensionValue(cid, value),

    setCircleRadius: (shapeId, r) =>
      update((d) => {
        const s = d.shapes.find((x) => x.id === shapeId)
        if (s && s.kind === 'circle') s.r = Math.max(0.05, r)
      }),

    setSegmentArc: (a, b, center, ccw) =>
      update((d) => {
        const seg = findLoopSegment(d, a, b)
        if (!seg) return
        const { loop, startPid } = seg
        if (!loop.arcs) loop.arcs = {}
        const existing = loop.arcs[startPid]
        if (existing) {
          const cp = d.points[existing.center]
          if (cp) {
            cp.x = center[0]
            cp.y = center[1]
          }
          loop.arcs[startPid] = { center: existing.center, ccw }
        } else {
          const cid = id()
          d.points[cid] = { x: center[0], y: center[1], fixed: false }
          loop.arcs[startPid] = { center: cid, ccw }
        }
        // The arc replaces its corners' geometry — drop treatments at both ends.
        if (loop.corners) {
          delete loop.corners[startPid]
          delete loop.corners[seg.endPid]
          if (Object.keys(loop.corners).length === 0) delete loop.corners
        }
      }),

    removeSegmentArc: (a, b) =>
      update((d) => {
        const seg = findLoopSegment(d, a, b)
        const arc = seg?.loop.arcs?.[seg.startPid]
        if (!seg || !arc || !seg.loop.arcs) return
        delete seg.loop.arcs[seg.startPid]
        if (Object.keys(seg.loop.arcs).length === 0) delete seg.loop.arcs
        delete d.points[arc.center]
        d.constraints = d.constraints.filter((c) => !constraintPoints(c).includes(arc.center))
      }),

    setArcRadius: (a, b, r) =>
      update((d) => {
        const seg = findLoopSegment(d, a, b)
        const arc = seg?.loop.arcs?.[seg.startPid]
        if (!seg || !arc) return
        const A = d.points[seg.startPid]
        const B = d.points[seg.endPid]
        const C = d.points[arc.center]
        if (!A || !B || !C) return
        const L = Math.hypot(B.x - A.x, B.y - A.y)
        if (L < 1e-6) return
        const radius = Math.max(L / 2, r) // can't be smaller than the semicircle
        // Slide the center along the chord's perpendicular bisector, keeping it
        // on its current side.
        const mx = (A.x + B.x) / 2
        const my = (A.y + B.y) / 2
        const nx = -(B.y - A.y) / L
        const ny = (B.x - A.x) / L
        const side = Math.sign((C.x - mx) * nx + (C.y - my) * ny) || 1
        const h = Math.sqrt(Math.max(0, radius * radius - (L * L) / 4))
        C.x = mx + nx * h * side
        C.y = my + ny * h * side
      }),

    setPointPos: (pid, x, y) =>
      update((d) => {
        const p = d.points[pid]
        if (p) {
          p.x = x
          p.y = y
        }
      }),

    setCornerTreatment: (pid, kind, size) =>
      update((d) => {
        if (!canTreatCorner(d, pid)) return // corners adjacent to an arc are off-limits
        const loop = d.shapes.find((s) => s.kind === 'loop' && s.pts.includes(pid))
        if (!loop || loop.kind !== 'loop') return
        if (!loop.corners) loop.corners = {}
        loop.corners[pid] = { kind, size: Math.max(0.1, size) }
      }),

    removeCornerTreatment: (pid) =>
      update((d) => {
        const loop = d.shapes.find((s) => s.kind === 'loop' && s.corners && pid in s.corners)
        if (!loop || loop.kind !== 'loop' || !loop.corners) return
        delete loop.corners[pid]
        if (Object.keys(loop.corners).length === 0) delete loop.corners
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

    mirrorSelection: (axis) => {
      const refs = get().selection
      if (refs.length === 0) return
      update((d) => {
        // Reflect across the chosen axis line through the origin.
        const flip = (p: SPoint): Vec2 => (axis === 'x' ? [p.x, -p.y] : [-p.x, p.y])
        // Shapes the selection touches (a point/segment names its parent shape).
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
        for (const s of d.shapes.filter((sh) => shapeIds.has(sh.id))) {
          if (s.kind === 'loop') {
            const map: Record<PointId, PointId> = {}
            for (const pid of s.pts) {
              const p = d.points[pid]
              if (!p) continue
              const np = id()
              const [x, y] = flip(p)
              d.points[np] = { x, y, fixed: false }
              map[pid] = np
            }
            const corners = s.corners
              ? Object.fromEntries(
                  Object.entries(s.corners)
                    .filter(([pid]) => map[pid])
                    .map(([pid, t]) => [map[pid], { ...t }]),
                )
              : undefined
            // Arc centers are loop-owned points too: clone + reflect them, and
            // flip each arc's sweep (a reflection reverses orientation).
            const arcs = s.arcs
              ? Object.fromEntries(
                  Object.entries(s.arcs)
                    .filter(([pid]) => map[pid] && d.points[s.arcs![pid].center])
                    .map(([pid, arc]) => {
                      const np = id()
                      const [x, y] = flip(d.points[arc.center])
                      d.points[np] = { x, y, fixed: false }
                      return [map[pid], { center: np, ccw: !arc.ccw }]
                    }),
                )
              : undefined
            d.shapes.push({
              id: id(),
              kind: 'loop',
              pts: s.pts.map((pid) => map[pid]).filter((p): p is PointId => Boolean(p)),
              ...(s.construction && { construction: true }),
              ...(corners && Object.keys(corners).length > 0 && { corners }),
              ...(arcs && Object.keys(arcs).length > 0 && { arcs }),
            })
          } else {
            const c = d.points[s.c]
            if (!c) continue
            const np = id()
            const [x, y] = flip(c)
            d.points[np] = { x, y, fixed: false }
            d.shapes.push({
              id: id(),
              kind: 'circle',
              c: np,
              r: s.r,
              ...(s.construction && { construction: true }),
            })
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
      const source: SketchSource = {
        data: cloneData(s.data),
        plane,
        ...(s.faceRef && { faceRef: s.faceRef }),
      }

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
          faceRef: null,
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
        faceRef: null,
        data: emptySketch(),
        selection: [],
      })
    },
  }
})
