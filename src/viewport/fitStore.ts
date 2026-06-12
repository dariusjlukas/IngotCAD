/**
 * The current model's world-space bounding box, derived from the rendered root
 * meshes, for the build-volume fit check. Kept tiny and separate from the CAD
 * store (it's derived display state, never serialized or undone).
 *
 * `requestFitRecompute()` is debounced to one read per animation frame so the
 * many sources that can change the bounds (geometry finishing async, a transform
 * commit, a node added/removed) coalesce into a single recompute. The actual
 * fit verdict lives in the status bar, which combines these bounds with the
 * printer-size preference (so it re-checks reactively when the bed changes).
 */
import { create } from 'zustand'
import type { Vec3 } from '../document/types'
import type { BuildVolume } from '../preferences/prefsStore'
import { unionWorldBounds } from './meshRegistry'

export interface ModelBounds {
  min: Vec3
  max: Vec3
}

/** A hair of slack so a part sized exactly to the bed isn't flagged. */
const FIT_EPSILON_MM = 1e-3

/**
 * Whether the model AABB pokes outside the printer build volume. The bed is
 * centered on the origin in XY and rises from z=0, matching how new objects are
 * placed (resting on the plate, near the origin).
 */
export function modelExceedsBuildVolume(bounds: ModelBounds, v: BuildVolume): boolean {
  const e = FIT_EPSILON_MM
  return (
    bounds.min[0] < -v.x / 2 - e ||
    bounds.max[0] > v.x / 2 + e ||
    bounds.min[1] < -v.y / 2 - e ||
    bounds.max[1] > v.y / 2 + e ||
    bounds.min[2] < -e ||
    bounds.max[2] > v.z + e
  )
}

interface FitState {
  /** World-space AABB of all visible roots, or null when the scene is empty. */
  bounds: ModelBounds | null
  setBounds: (bounds: ModelBounds | null) => void
}

export const useFitStore = create<FitState>((set) => ({
  bounds: null,
  setBounds: (bounds) => set({ bounds }),
}))

function boundsEqual(a: ModelBounds | null, b: ModelBounds | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-4
  return a.min.every((v, i) => eq(v, b.min[i])) && a.max.every((v, i) => eq(v, b.max[i]))
}

let pending = 0

/** Recompute the model bounds on the next frame (coalesces rapid callers). */
export function requestFitRecompute(): void {
  if (pending) return
  pending = requestAnimationFrame(() => {
    pending = 0
    const box = unionWorldBounds()
    const next: ModelBounds | null = box
      ? { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }
      : null
    const { bounds, setBounds } = useFitStore.getState()
    if (!boundsEqual(bounds, next)) setBounds(next)
  })
}
