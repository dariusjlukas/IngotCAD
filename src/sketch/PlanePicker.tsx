/**
 * Shown over the 3D viewport while starting a sketch: pick a cardinal plane, or
 * click a face of an object (handled in NodeView, which calls chooseFace).
 */
import { useEffect } from 'react'
import { useSketchStore } from './sketchStore'

export function PlanePicker() {
  const chooseCardinal = useSketchStore((s) => s.chooseCardinal)
  const cancel = useSketchStore((s) => s.cancel)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  const btn = 'rounded bg-neutral-800 px-2.5 py-1 text-sm text-neutral-100 hover:bg-blue-600'

  return (
    <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900/95 px-3 py-2 shadow-xl">
      <span className="text-sm font-medium text-neutral-200">New sketch — choose a plane:</span>
      <button type="button" className={btn} onClick={() => chooseCardinal('xy')}>
        Top (XY)
      </button>
      <button type="button" className={btn} onClick={() => chooseCardinal('xz')}>
        Front (XZ)
      </button>
      <button type="button" className={btn} onClick={() => chooseCardinal('yz')}>
        Right (YZ)
      </button>
      <span className="text-xs text-neutral-500">or click a face of an object</span>
      <button
        type="button"
        className="rounded px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-700"
        onClick={cancel}
      >
        Cancel
      </button>
    </div>
  )
}
