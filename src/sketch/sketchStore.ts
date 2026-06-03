/** Sketch-mode state: the parametric shapes being drawn and the extrude height. */
import { create } from 'zustand'
import type { Vec2 } from '../document/types'
import { useCadStore } from '../document/store'
import type { SketchShape } from './shapes'
import { shapeToContour } from './shapes'

export type SketchTool = 'select' | 'rectangle' | 'circle' | 'polygon'

interface SketchState {
  active: boolean
  tool: SketchTool
  shapes: SketchShape[]
  /** Polygon-in-progress vertices (only while the polygon tool is drawing). */
  draft: Vec2[]
  selectedIndex: number | null
  height: number

  open: () => void
  cancel: () => void
  setTool: (tool: SketchTool) => void
  setHeight: (height: number) => void

  addShape: (shape: SketchShape) => void
  updateShape: (index: number, shape: SketchShape) => void
  selectShape: (index: number | null) => void
  deleteSelected: () => void

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
  selectedIndex: null,
  height: 10,

  open: () => set({ active: true, shapes: [], draft: [], selectedIndex: null, tool: 'rectangle' }),
  cancel: () => set({ active: false, shapes: [], draft: [], selectedIndex: null }),
  setTool: (tool) =>
    set((s) => ({
      tool,
      draft: tool === 'polygon' ? s.draft : [],
      selectedIndex: tool === 'select' ? s.selectedIndex : null,
    })),
  setHeight: (height) => set({ height: Math.max(0.1, height) }),

  addShape: (shape) => set((s) => ({ shapes: [...s.shapes, shape] })),
  updateShape: (index, shape) =>
    set((s) => ({ shapes: s.shapes.map((sh, i) => (i === index ? shape : sh)) })),
  selectShape: (index) => set({ selectedIndex: index }),
  deleteSelected: () =>
    set((s) =>
      s.selectedIndex == null
        ? {}
        : { shapes: s.shapes.filter((_, i) => i !== s.selectedIndex), selectedIndex: null },
    ),

  addDraftPoint: (point) => set((s) => ({ draft: [...s.draft, point] })),
  closeDraft: () =>
    set((s) =>
      s.draft.length >= 3
        ? { shapes: [...s.shapes, { kind: 'polygon', points: s.draft }], draft: [] }
        : {},
    ),
  undoLast: () =>
    set((s) => {
      if (s.draft.length > 0) return { draft: s.draft.slice(0, -1) }
      if (s.shapes.length > 0) return { shapes: s.shapes.slice(0, -1), selectedIndex: null }
      return {}
    }),
  clear: () => set({ shapes: [], draft: [], selectedIndex: null }),

  commit: () => {
    const s = get()
    const contours: Vec2[][] = s.shapes.map(shapeToContour)
    if (s.draft.length >= 3) contours.push(s.draft)
    if (contours.length === 0) return
    const created = useCadStore.getState().addExtrusion(contours, s.height)
    if (created) set({ active: false, shapes: [], draft: [], selectedIndex: null })
  },
}))
