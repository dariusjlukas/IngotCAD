/** Transient viewport UI state (not part of the saved document). */
import { create } from 'zustand'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

/** The home view: matches the <Canvas> camera prop, target at the origin. */
export const DEFAULT_CAMERA_POSITION: [number, number, number] = [140, -180, 140]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0, 0]

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
  /** Bumped to ask the camera to fly back to the home view (0 means "never"). */
  resetNonce: number
  resetView: () => void
}

export const useViewportStore = create<ViewportState>((set) => ({
  gizmoMode: 'translate',
  setGizmoMode: (gizmoMode) => set({ gizmoMode }),
  focusTarget: null,
  requestFocus: (center, radius) =>
    set((s) => ({ focusTarget: { center, radius, nonce: (s.focusTarget?.nonce ?? 0) + 1 } })),
  resetNonce: 0,
  resetView: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),
}))
