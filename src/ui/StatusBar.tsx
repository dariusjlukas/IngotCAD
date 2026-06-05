/** Bottom bar: units, object count, and live stats for the current selection. */
import { useEffect, useState } from 'react'
import { useCadStore } from '../document/store'
import { engine } from '../engine/engine'

export function StatusBar() {
  const rootCount = useCadStore((s) => s.doc.rootIds.length)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const doc = useCadStore((s) => s.doc)
  // Tag the measurement with the node it describes so a stale result from a
  // previous selection is simply ignored at render time (no sync reset needed).
  const [info, setInfo] = useState<{ id: string; triangles: number; volume: number } | null>(null)

  useEffect(() => {
    if (selectedIds.length !== 1) return
    const id = selectedIds[0]
    let cancelled = false
    engine.measure(doc, id).then((r) => {
      if (!cancelled) setInfo({ id, ...r })
    })
    return () => {
      cancelled = true
    }
  }, [selectedIds, doc])

  const current = selectedIds.length === 1 && info?.id === selectedIds[0] ? info : null

  return (
    <div className="flex items-center gap-4 border-t border-line bg-panel px-3 py-1 text-xs text-fg-muted">
      <span>mm · Z-up</span>
      <span>
        {rootCount} object{rootCount === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      {current && (
        <>
          <span>{current.triangles.toLocaleString()} triangles</span>
          <span>{(current.volume / 1000).toFixed(2)} cm³</span>
        </>
      )}
    </div>
  )
}
