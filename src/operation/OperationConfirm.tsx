/** Panel shown over the viewport while a pending extrude/revolve awaits confirmation. */
import { useEffect } from 'react'
import { useOperationStore } from './operationStore'
import { NumberField } from '../ui/NumberField'

export function OperationConfirm() {
  const pending = useOperationStore((s) => s.pending)
  const setValue = useOperationStore((s) => s.setValue)
  const setSignedValue = useOperationStore((s) => s.setSignedValue)
  const toggleFlip = useOperationStore((s) => s.toggleFlip)
  const confirm = useOperationStore((s) => s.confirm)
  const cancel = useOperationStore((s) => s.cancel)

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter') {
        e.preventDefault()
        confirm()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, confirm, cancel])

  if (!pending) return null
  const isExtrude = pending.mode === 'extrude'
  const max = isExtrude ? 200 : 360
  const step = isExtrude ? 0.5 : 1
  // Extrude is signed (negative auto-flips); the displayed field value is |value|.
  const onField = isExtrude ? setSignedValue : setValue
  const signed = pending.flip ? -pending.value : pending.value

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-wrap items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900/95 px-4 py-3 shadow-xl">
      <span className="text-sm font-medium capitalize text-neutral-100">{pending.mode}</span>
      <label className="flex items-center gap-1.5 text-sm text-neutral-400">
        {isExtrude ? 'Height' : 'Angle'}
        <div className="w-20">
          {/* No min for extrude so a negative value can flip; field shows |value|. */}
          <NumberField value={pending.value} min={isExtrude ? undefined : 1} step={step} onCommit={onField} />
        </div>
        {isExtrude ? 'mm' : '°'}
      </label>
      <input
        type="range"
        min={isExtrude ? -max : 1}
        max={max}
        step={step}
        value={isExtrude ? Math.max(-max, Math.min(max, signed)) : Math.min(pending.value, max)}
        onChange={(e) => onField(parseFloat(e.target.value))}
        className="w-40 accent-blue-500"
      />
      {isExtrude && (
        <button
          type="button"
          onClick={toggleFlip}
          className={
            'rounded px-3 py-1 text-sm ' +
            (pending.flip ? 'bg-neutral-700 text-white' : 'text-neutral-200 hover:bg-neutral-700')
          }
          title="Extrude to the other side of the plane"
        >
          Flip
        </button>
      )}
      <span className="hidden text-xs text-neutral-500 sm:inline">drag the arrow, or use the slider</span>
      <button
        type="button"
        onClick={cancel}
        className="rounded px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={confirm}
        className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500"
      >
        Confirm
      </button>
    </div>
  )
}
