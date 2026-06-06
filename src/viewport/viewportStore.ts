/** Transient viewport UI state (not part of the saved document). */
import { create } from 'zustand'

/** The transform gizmo's modes (each maps to a TransformControls `mode`). */
export type GizmoMode = 'translate' | 'rotate' | 'scale'

/**
 * The active viewport tool. `select` only picks objects (no gizmo); the other
 * three additionally show the transform gizmo in the matching mode.
 */
export type ToolMode = 'select' | GizmoMode

/** The home view: matches the <Canvas> camera prop, target at the origin. */
export const DEFAULT_CAMERA_POSITION: [number, number, number] = [140, -180, 140]
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0, 0]

/** A request to frame a point in space; `nonce` makes repeat requests fire. */
export interface FocusTarget {
  center: [number, number, number]
  radius: number
  nonce: number
}

/** A request to look along a direction (a Top/Front/Right/Iso preset). */
export interface ViewRequest {
  /** Direction from the target to the camera (need not be normalized). */
  dir: [number, number, number]
  nonce: number
}

/**
 * Camera state for the locked sketch view (owned by SketchCameraLock):
 *   idle     — normal 3D viewport
 *   entering — flying from the prior 3D view onto the sketch plane
 *   locked   — docked head-on to the plane; the sketch SVG is shown
 *   exiting  — flying back to the prior 3D view
 * Orthographic is forced for any non-idle phase (so the swap is seamless at the
 * docked ends); the sketch SVG + scrim are revealed only once `locked`.
 */
export type SketchCamPhase = 'idle' | 'entering' | 'locked' | 'exiting'

interface ViewportState {
  tool: ToolMode
  setTool: (tool: ToolMode) => void
  focusTarget: FocusTarget | null
  requestFocus: (center: [number, number, number], radius: number) => void
  /** Bumped to ask the camera to fly back to the home view (0 means "never"). */
  resetNonce: number
  resetView: () => void
  /** A pending request to snap the camera to a named view direction. */
  viewRequest: ViewRequest | null
  setView: (dir: [number, number, number]) => void
  /** Sketch-camera transition phase (see SketchCamPhase). */
  sketchCamPhase: SketchCamPhase
  setSketchCamPhase: (phase: SketchCamPhase) => void
}

export const useViewportStore = create<ViewportState>((set) => ({
  tool: 'select',
  setTool: (tool) => set({ tool }),
  focusTarget: null,
  requestFocus: (center, radius) =>
    set((s) => ({ focusTarget: { center, radius, nonce: (s.focusTarget?.nonce ?? 0) + 1 } })),
  resetNonce: 0,
  resetView: () => set((s) => ({ resetNonce: s.resetNonce + 1 })),
  viewRequest: null,
  setView: (dir) => set((s) => ({ viewRequest: { dir, nonce: (s.viewRequest?.nonce ?? 0) + 1 } })),
  sketchCamPhase: 'idle',
  setSketchCamPhase: (sketchCamPhase) => set({ sketchCamPhase }),
}))
