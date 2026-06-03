/** Sketch-mode state: the 2D profile being drawn and the extrude height. */
import { create } from 'zustand'
import type { Vec2 } from '../document/types'
import { useCadStore } from '../document/store'
import { ensureCCW } from './geometry'

export type SketchTool = 'rectangle' | 'circle' | 'polygon'

interface SketchState {
  active: boolean
  tool: SketchTool
  /** Completed closed contours, in mm on the XY plane. */
  shapes: Vec2[][]
  /** Polygon-in-progress vertices. */
  draft: Vec2[]
  height: number

  open: () => void
  cancel: () => void
  setTool: (tool: SketchTool) => void
  setHeight: (height: number) => void
  addShape: (contour: Vec2[]) => void
  addDraftPoint: (point: Vec2) => void
  closeDraft: () => void
  undoLast: () => void
  clear: () => void
  /** Extrude the profile into a solid and exit sketch mode. */
  commit: () => void
}

export const useSketchStore = create<SketchState>((set, get) => ({
  active: false,
  tool: 'rectangle',
  shapes: [],
  draft: [],
  height: 10,

  open: () => set({ active: true, shapes: [], draft: [], tool: 'rectangle' }),
  cancel: () => set({ active: false, shapes: [], draft: [] }),
  setTool: (tool) => set((s) => ({ tool, draft: tool === 'polygon' ? s.draft : [] })),
  setHeight: (height) => set({ height: Math.max(0.1, height) }),

  addShape: (contour) => set((s) => ({ shapes: [...s.shapes, ensureCCW(contour)] })),
  addDraftPoint: (point) => set((s) => ({ draft: [...s.draft, point] })),
  closeDraft: () =>
    set((s) => (s.draft.length >= 3 ? { shapes: [...s.shapes, ensureCCW(s.draft)], draft: [] } : {})),
  undoLast: () =>
    set((s) => {
      if (s.draft.length > 0) return { draft: s.draft.slice(0, -1) }
      if (s.shapes.length > 0) return { shapes: s.shapes.slice(0, -1) }
      return {}
    }),
  clear: () => set({ shapes: [], draft: [] }),

  commit: () => {
    const s = get()
    const contours = [...s.shapes]
    if (s.draft.length >= 3) contours.push(s.draft)
    if (contours.length === 0) return
    const created = useCadStore.getState().addExtrusion(contours, s.height)
    if (created) set({ active: false, shapes: [], draft: [] })
  },
}))
