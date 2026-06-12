/**
 * Engine busy state for the UI: how many evaluation jobs are pending in the
 * worker, and whether any have been running long enough to call out (a slow
 * boolean on a heavy imported mesh). Derived display state — tiny, transient,
 * separate from the CAD store.
 *
 * `jobStarted`/`jobFinished` are imperative (called from the worker client,
 * outside React), mirroring the toastStore pattern.
 */
import { create } from 'zustand'

/** A job in flight longer than this is reported as slow. */
const SLOW_JOB_MS = 300

interface EngineStatusState {
  /** Requests posted to the worker and not yet settled. */
  pendingCount: number
  /** True once any current batch of work has been in flight > SLOW_JOB_MS. */
  slow: boolean
}

export const useEngineStatusStore = create<EngineStatusState>(() => ({
  pendingCount: 0,
  slow: false,
}))

let slowTimer: ReturnType<typeof setTimeout> | null = null

export function jobStarted(): void {
  const { pendingCount } = useEngineStatusStore.getState()
  useEngineStatusStore.setState({ pendingCount: pendingCount + 1 })
  if (slowTimer === null) {
    slowTimer = setTimeout(() => {
      slowTimer = null
      if (useEngineStatusStore.getState().pendingCount > 0) {
        useEngineStatusStore.setState({ slow: true })
      }
    }, SLOW_JOB_MS)
  }
}

export function jobFinished(): void {
  const { pendingCount } = useEngineStatusStore.getState()
  const next = Math.max(0, pendingCount - 1)
  if (next === 0) {
    if (slowTimer !== null) {
      clearTimeout(slowTimer)
      slowTimer = null
    }
    useEngineStatusStore.setState({ pendingCount: 0, slow: false })
  } else {
    useEngineStatusStore.setState({ pendingCount: next })
  }
}
