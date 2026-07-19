/**
 * Shown over the 3D viewport while starting a sketch: pick a cardinal plane, or
 * click a face of an object (handled in NodeView, which calls chooseFace).
 */
import { useEffect } from 'react'
import { useSketchStore } from './sketchStore'
import { useCadStore } from '../document/store'
import { resolvedFacePlane, useResolvedStore } from '../document/resolvedStore'
import { resolvePlaneDefinition } from './plane'

export function PlanePicker() {
  const chooseCardinal = useSketchStore((s) => s.chooseCardinal)
  const chooseConstructionPlane = useSketchStore((s) => s.chooseConstructionPlane)
  const cancel = useSketchStore((s) => s.cancel)
  const planeOrder = useCadStore((s) => s.doc.planeOrder)
  const planes = useCadStore((s) => s.doc.planes)
  const resolvedDeps = useResolvedStore((s) => s.dependents)

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

  const btn =
    'rounded bg-elevated px-2.5 py-1 text-sm text-fg-strong hover:bg-accent hover:text-on-accent'

  return (
    <div className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-line-strong bg-panel/95 px-3 py-2 shadow-xl">
      <span className="text-sm font-medium text-fg">New sketch — choose a plane:</span>
      <button type="button" className={btn} onClick={() => chooseCardinal('xy')}>
        Top (XY)
      </button>
      <button type="button" className={btn} onClick={() => chooseCardinal('xz')}>
        Front (XZ)
      </button>
      <button type="button" className={btn} onClick={() => chooseCardinal('yz')}>
        Right (YZ)
      </button>
      <span className="text-xs text-fg-faint">or click a face of an object</span>
      {planeOrder.length > 0 && (
        <>
          <div className="mx-0.5 h-5 w-px bg-line-strong" />
          {planeOrder.map((id) => {
            const p = planes[id]
            if (!p) return null
            return (
              <button
                key={id}
                type="button"
                className={btn}
                title="Sketch on this construction plane"
                onClick={() =>
                  chooseConstructionPlane(
                    resolvedFacePlane(resolvedDeps[id], p.definition) ??
                      resolvePlaneDefinition(p.definition),
                    p.name,
                  )
                }
              >
                {p.name}
              </button>
            )
          })}
        </>
      )}
      <button
        type="button"
        className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-elevated"
        onClick={cancel}
      >
        Cancel
      </button>
    </div>
  )
}
