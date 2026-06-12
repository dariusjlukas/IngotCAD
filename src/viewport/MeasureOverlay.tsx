/**
 * HTML overlay for the Measure tool (the PlaneBuilderOverlay pattern): an
 * instruction bar with the pending pick's readout, plus the list of completed
 * measurements. Escape clears the pending pick first, then exits the tool.
 */
import { useEffect } from 'react'
import { useMeasureStore } from './measureStore'
import { describeResult, entityInfo } from './measureGeometry'

export function MeasureOverlay() {
  const active = useMeasureStore((s) => s.active)
  const pending = useMeasureStore((s) => s.pending)
  const measurements = useMeasureStore((s) => s.measurements)
  const cancel = useMeasureStore((s) => s.cancel)
  const clearAll = useMeasureStore((s) => s.clearAll)
  const clearPending = useMeasureStore((s) => s.clearPending)
  const removeMeasurement = useMeasureStore((s) => s.removeMeasurement)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      const s = useMeasureStore.getState()
      if (s.pending) s.clearPending()
      else s.cancel()
    }
    // Capture phase so the app-level Escape (deselect) doesn't also fire.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, clearPending, cancel])

  if (!active) return null

  return (
    <div className="absolute top-4 left-1/2 z-20 flex w-max max-w-[80%] -translate-x-1/2 flex-col gap-1.5 rounded-lg border border-line-strong bg-panel/95 px-3 py-2 shadow-xl">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-fg">
          Measure —{' '}
          {pending
            ? 'click the second vertex, edge, face, or circle'
            : 'click a vertex, edge, face, or circle'}
        </span>
        {measurements.length > 0 && (
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-elevated"
            onClick={clearAll}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-elevated"
          onClick={cancel}
        >
          Done
        </button>
      </div>
      {pending && (
        <div className="text-xs text-fg-muted">
          {entityInfo(pending).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {measurements.length > 0 && (
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
          {measurements.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-xs text-fg">
              <span className="font-mono">{describeResult(m.result)}</span>
              <button
                type="button"
                className="rounded px-1 text-fg-faint hover:bg-elevated hover:text-danger"
                onClick={() => removeMeasurement(m.id)}
                title="Remove this measurement"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
