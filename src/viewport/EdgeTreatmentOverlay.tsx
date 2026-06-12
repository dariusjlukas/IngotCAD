/**
 * Shown over the viewport while picking edges for a chamfer/fillet (the
 * PlaneBuilderOverlay pattern): instruction, kind/size controls for the next
 * pick, and Done (Escape also exits). Picked edges land in the document
 * immediately, so each click is one undoable step.
 */
import { useEffect } from 'react'
import { useEdgeTreatmentStore } from './edgeTreatmentStore'
import { useCadStore } from '../document/store'
import { NumberField } from '../ui/NumberField'

export function EdgeTreatmentOverlay() {
  const nodeId = useEdgeTreatmentStore((s) => s.nodeId)
  const kind = useEdgeTreatmentStore((s) => s.kind)
  const size = useEdgeTreatmentStore((s) => s.size)
  const start = useEdgeTreatmentStore((s) => s.start)
  const cancel = useEdgeTreatmentStore((s) => s.cancel)
  const entryCount = useCadStore((s) => {
    const n = nodeId ? s.doc.nodes[nodeId] : null
    return n?.kind === 'edgeTreatment' ? n.entries.length : 0
  })

  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [nodeId, cancel])

  if (!nodeId) return null

  return (
    <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-panel/95 px-3 py-2 shadow-xl">
      <span className="text-sm font-medium text-fg">
        Click sharp edges to {kind} ({entryCount} picked)
      </span>
      <div className="flex overflow-hidden rounded border border-line-strong">
        {(['chamfer', 'fillet'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => start(nodeId, k, size)}
            className={
              'px-2 py-0.5 text-sm capitalize ' +
              (kind === k ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
            }
          >
            {k}
          </button>
        ))}
      </div>
      <div className="w-16">
        <NumberField value={size} min={0.05} onCommit={(v) => start(nodeId, kind, v)} />
      </div>
      <button
        type="button"
        className="rounded px-2 py-1 text-sm text-fg-muted hover:bg-elevated"
        onClick={cancel}
      >
        Done
      </button>
    </div>
  )
}
