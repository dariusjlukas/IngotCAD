/**
 * Transient "create a construction plane by picking" mode. The toolbar starts a
 * tool; NodeView feeds it picks from the viewport; once enough geometry is
 * gathered it creates the plane (via the CAD store) and resets. Not part of the
 * saved document or undo history.
 */
import { create } from 'zustand'
import type { FaceRef, Vec3 } from '../document/types'
import { useCadStore } from '../document/store'

export type PlaneTool = 'face' | 'threePoints' | 'edgeAngle'

interface PlaneBuilderState {
  tool: PlaneTool | null
  /** Points picked so far (for the three-points tool). */
  points: Vec3[]
  start: (tool: PlaneTool) => void
  cancel: () => void
  /** A face was clicked: build a plane parallel to it (offset 0). `source`
   *  records which face for stale detection. */
  pickFace: (origin: Vec3, normal: Vec3, source?: FaceRef) => void
  /** A surface point was clicked: accumulate, and build once three are picked. */
  pickPoint: (point: Vec3) => void
  /** An edge was clicked: build a plane hinged on it (angle 0 = the picked face). */
  pickEdge: (origin: Vec3, axis: Vec3, refNormal: Vec3) => void
}

export const usePlaneBuilderStore = create<PlaneBuilderState>((set, get) => ({
  tool: null,
  points: [],
  start: (tool) => set({ tool, points: [] }),
  cancel: () => set({ tool: null, points: [] }),

  pickFace: (origin, normal, source) => {
    useCadStore
      .getState()
      .addPlane({ kind: 'face', origin, normal, distance: 0, ...(source && { source }) })
    set({ tool: null, points: [] })
  },
  pickPoint: (point) => {
    const points = [...get().points, point]
    if (points.length >= 3) {
      useCadStore
        .getState()
        .addPlane({ kind: 'threePoints', a: points[0], b: points[1], c: points[2] })
      set({ tool: null, points: [] })
    } else {
      set({ points })
    }
  },
  pickEdge: (origin, axis, refNormal) => {
    useCadStore.getState().addPlane({ kind: 'edgeAngle', origin, axis, refNormal, angleDeg: 0 })
    set({ tool: null, points: [] })
  },
}))
