/** Transient viewport UI state (not part of the saved document). */
import { create } from 'zustand'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/** A request to frame a point in space; `nonce` makes repeat requests fire. */
export interface FocusTarget {
  center: [number, number, number]
  radius: number
  nonce: number
}

interface ViewportState {
  gizmoMode: GizmoMode
  setGizmoMode: (mode: GizmoMode) => void
  focusTarget: FocusTarget | null
  requestFocus: (center: [number, number, number], radius: number) => void
}

export const useViewportStore = create<ViewportState>((set) => ({
  gizmoMode: 'translate',
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  focusTarget: null,
  requestFocus: (center, radius) =>
    set((s) => ({ focusTarget: { center, radius, nonce: (s.focusTarget?.nonce ?? 0) + 1 } })),
}))
