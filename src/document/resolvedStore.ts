/**
 * Resolved face-attachment frames, derived by FaceRefMonitor from the current
 * document + source meshes (see resolve.ts). Transient display/derivation
 * state — never serialized, never in undo history. The stored snapshots in the
 * document remain the authority for what a save contains; these frames are
 * where dependents currently SIT because their source faces moved.
 */
import { create } from 'zustand'
import type { ResolvedDependent } from './resolve'
import type { NodeId, PlaneDefinition, SketchPlane, Transform } from './types'

interface ResolvedState {
  dependents: Record<string, ResolvedDependent>
  /** Dependent keys frozen because following them would create a cycle. */
  cycles: string[]
  /**
   * Parent-relative transform overrides for ROOT node dependents that are
   * auto-following ('moved'). This exact set is applied to rendering AND to
   * exports/section projections, so what you see is always what you print.
   * (Nested dependents don't auto-follow in Stage A — they surface status
   * only — precisely so this render/export equivalence holds.)
   */
  rootOverrides: Record<NodeId, Transform>
}

export const useResolvedStore = create<ResolvedState>(() => ({
  dependents: {},
  cycles: [],
  rootOverrides: {},
}))

export function setResolved(
  dependents: Record<string, ResolvedDependent>,
  cycles: string[],
  rootIds: readonly NodeId[],
): void {
  const rootOverrides: Record<NodeId, Transform> = {}
  for (const dep of Object.values(dependents)) {
    if (
      dep.kind === 'node' &&
      dep.status === 'moved' &&
      dep.nodeTransform &&
      rootIds.includes(dep.key)
    ) {
      rootOverrides[dep.key] = dep.nodeTransform
    }
  }
  useResolvedStore.setState({ dependents, cycles, rootOverrides })
}

/** The current render/export override set (empty when nothing is following). */
export function currentRootOverrides(): Record<NodeId, Transform> {
  return useResolvedStore.getState().rootOverrides
}

/**
 * The effective plane of a face-derived construction plane while it is
 * auto-following ('moved'): the resolved face frame shifted by the
 * definition's offset distance. Null when the stored definition is current
 * (callers fall back to `resolvePlaneDefinition`).
 */
export function resolvedFacePlane(
  dep: ResolvedDependent | undefined,
  def: PlaneDefinition,
): SketchPlane | null {
  if (def.kind !== 'face' || dep?.status !== 'moved') return null
  const p = dep.plane
  const d = def.distance
  return {
    ...p,
    origin: [p.origin[0] + p.n[0] * d, p.origin[1] + p.n[1] * d, p.origin[2] + p.n[2] * d],
  }
}
