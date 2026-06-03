/** Bottom bar: units, object count, and live stats for the current selection. */
import { useEffect, useState } from 'react'
import { useCadStore } from '../document/store'
import { engine } from '../engine/engine'

export function StatusBar() {
  const rootCount = useCadStore((s) => s.doc.rootIds.length)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const doc = useCadStore((s) => s.doc)
  const [info, setInfo] = useState<{ triangles: number; volume: number } | null>(null)

  useEffect(() => {
    if (selectedIds.length !== 1) {
      setInfo(null)
      return
    }
    let cancelled = false
    engine.measure(doc, selectedIds[0]).then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [selectedIds, doc])

  return (
    <div className="flex items-center gap-4 border-t border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
      <span>mm · Z-up</span>
      <span>
        {rootCount} object{rootCount === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      {info && (
        <>
          <span>{info.triangles.toLocaleString()} triangles</span>
          <span>{(info.volume / 1000).toFixed(2)} cm³</span>
        </>
      )}
    </div>
  )
}
