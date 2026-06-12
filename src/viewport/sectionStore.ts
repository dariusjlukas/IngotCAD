/**
 * Transient section-view state: one axis-aligned clipping plane for inspecting
 * cross-sections. Render-level clipping only (cut faces appear hollow) — a
 * working view, not a document feature: not persisted, not undoable. The
 * upgrade path (a draggable plane handle, capped boolean sections) only
 * changes consumers, not this store.
 */
import { useMemo } from 'react'
import { create } from 'zustand'
import * as THREE from 'three'
import { useFitStore } from './fitStore'

export type SectionAxis = 'x' | 'y' | 'z'

const AXIS_INDEX: Record<SectionAxis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 }

interface SectionState {
  enabled: boolean
  axis: SectionAxis
  /** Plane position along the axis, world mm. */
  offset: number
  /** false: keep the −axis side; true: keep the +axis side. */
  flip: boolean
  setEnabled: (v: boolean) => void
  setAxis: (a: SectionAxis) => void
  setOffset: (mm: number) => void
  toggleFlip: () => void
}

/** Midpoint of the model bounds along `axis` (fallback 0). */
function boundsMid(axis: SectionAxis): number {
  const b = useFitStore.getState().bounds
  if (!b) return 0
  const i = AXIS_INDEX[axis]
  return (b.min[i] + b.max[i]) / 2
}

export const useSectionStore = create<SectionState>((set, get) => ({
  enabled: false,
  axis: 'z',
  offset: 0,
  flip: false,
  setEnabled: (v) => set(v ? { enabled: true, offset: boundsMid(get().axis) } : { enabled: false }),
  setAxis: (axis) => set({ axis, offset: boundsMid(axis) }),
  setOffset: (offset) => set({ offset }),
  toggleFlip: () => set({ flip: !get().flip }),
}))

/**
 * The THREE.Plane for the current state. three.js clips fragments where
 * plane.distanceToPoint(p) < 0, so the normal points toward the KEPT side:
 * default keeps the −axis side (normal −axis, constant +offset); flip keeps +.
 */
export function sectionPlane(s: Pick<SectionState, 'axis' | 'offset' | 'flip'>): THREE.Plane {
  const n = new THREE.Vector3()
  n.setComponent(AXIS_INDEX[s.axis], s.flip ? 1 : -1)
  return new THREE.Plane(n, s.flip ? -s.offset : s.offset)
}

/** Memoized clipping-plane array for material props (undefined when disabled). */
export function useSectionPlanes(): THREE.Plane[] | undefined {
  const enabled = useSectionStore((s) => s.enabled)
  const axis = useSectionStore((s) => s.axis)
  const offset = useSectionStore((s) => s.offset)
  const flip = useSectionStore((s) => s.flip)
  return useMemo(
    () => (enabled ? [sectionPlane({ axis, offset, flip })] : undefined),
    [enabled, axis, offset, flip],
  )
}

/** World-space visibility test for pointer hits (raycasting ignores clipping). */
export function pointIsClipped(p: { x: number; y: number; z: number }): boolean {
  const s = useSectionStore.getState()
  if (!s.enabled) return false
  return sectionPlane(s).distanceToPoint(new THREE.Vector3(p.x, p.y, p.z)) < 0
}
