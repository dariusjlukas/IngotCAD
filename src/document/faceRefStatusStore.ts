/**
 * Stale-face statuses, derived by FaceRefMonitor — keyed by the dependent
 * plane id or node id. Only STALE entries are stored (absence = healthy).
 * Transient display state; the document snapshot stays authoritative and is
 * only changed by an explicit, undoable Rebind.
 */
import { create } from 'zustand'
import type { Vec3 } from './types'
import { toast } from '../ui/toastStore'

export interface StaleFaceInfo {
  status: 'moved' | 'missing'
  /** Friendly name of the dependent (for the toast). */
  label: string
  /** Re-matched frame for a one-click rebind (only when status = 'moved'). */
  rebind?: {
    origin: Vec3
    normal: Vec3
    /** The re-matched face plane in the source's local space. */
    localNormal: Vec3
    localOffset: number
  }
}

interface FaceRefStatusState {
  stale: Record<string, StaleFaceInfo>
}

export const useFaceRefStatusStore = create<FaceRefStatusState>(() => ({
  stale: {},
}))

/** Replace all statuses; toasts once per newly-stale dependent. */
export function setStaleFaceStatuses(next: Record<string, StaleFaceInfo>): void {
  const prev = useFaceRefStatusStore.getState().stale
  for (const [key, info] of Object.entries(next)) {
    if (!prev[key]) {
      toast.info(
        info.status === 'moved'
          ? `"${info.label}" no longer sits on its source face.`
          : `"${info.label}" lost its source face.`,
      )
    }
  }
  // Compare full payloads, not just statuses: after a source face moves a
  // SECOND time the key and status ('moved') are identical but the rebind
  // frame differs — skipping the update would make "Rebind to face" write the
  // first move's outdated plane into the document forever.
  const changed =
    Object.keys(prev).length !== Object.keys(next).length ||
    Object.entries(next).some(([k, v]) => JSON.stringify(prev[k]) !== JSON.stringify(v))
  if (changed) useFaceRefStatusStore.setState({ stale: next })
}
