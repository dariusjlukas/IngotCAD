/**
 * Transient Measure-tool state (the planeBuilderStore pattern): the toolbar /
 * M key toggles it; NodeView feeds it world-space entity picks; completed
 * pairs accumulate in a list until cleared. Never touches the document or
 * undo history.
 */
import { create } from 'zustand'
import type { MeasureEntity, MeasureResult } from './measureGeometry'
import { measurePair } from './measureGeometry'

export interface Measurement {
  id: number
  a: MeasureEntity
  b: MeasureEntity
  result: MeasureResult
}

interface MeasureState {
  active: boolean
  /** First pick of the current pair, awaiting its partner. */
  pending: MeasureEntity | null
  measurements: Measurement[]
  start: () => void
  /** Exit the tool and drop everything. */
  cancel: () => void
  /** Keep measuring, drop the list. */
  clearAll: () => void
  pick: (e: MeasureEntity) => void
  clearPending: () => void
  removeMeasurement: (id: number) => void
}

let nextId = 1

export const useMeasureStore = create<MeasureState>((set, get) => ({
  active: false,
  pending: null,
  measurements: [],
  start: () => set({ active: true, pending: null }),
  cancel: () => set({ active: false, pending: null, measurements: [] }),
  clearAll: () => set({ pending: null, measurements: [] }),
  pick: (e) => {
    const { pending, measurements } = get()
    if (!pending) {
      set({ pending: e })
      return
    }
    const m: Measurement = { id: nextId++, a: pending, b: e, result: measurePair(pending, e) }
    set({ pending: null, measurements: [...measurements, m] })
  },
  clearPending: () => set({ pending: null }),
  removeMeasurement: (id) => set({ measurements: get().measurements.filter((m) => m.id !== id) }),
}))

/** Toggle helper for the toolbar / keyboard shortcut. */
export function toggleMeasure(): void {
  const s = useMeasureStore.getState()
  if (s.active) s.cancel()
  else s.start()
}
