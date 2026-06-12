/** Bottom bar: units, object count, build-fit, and live stats for the selection. */
import { useEffect, useState } from 'react'
import { useCadStore } from '../document/store'
import { engine } from '../engine/engine'
import { usePrefsStore } from '../preferences/prefsStore'
import { modelExceedsBuildVolume, useFitStore } from '../viewport/fitStore'

/** Trim to at most 1 decimal without trailing zeros (e.g. 256, 128.5). */
function fmt(n: number): string {
  return String(Number(n.toFixed(1)))
}

export function StatusBar() {
  const rootCount = useCadStore((s) => s.doc.rootIds.length)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const doc = useCadStore((s) => s.doc)
  const bounds = useFitStore((s) => s.bounds)
  const buildVolume = usePrefsStore((s) => s.buildVolume)
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

  // Overall model footprint (mm) and whether it overflows the printer bed.
  const size = bounds
    ? ([
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ] as const)
    : null
  const oversize = bounds ? modelExceedsBuildVolume(bounds, buildVolume) : false

  return (
    <div className="flex items-center gap-4 border-t border-line bg-panel px-3 py-1 text-xs text-fg-muted">
      <span>mm · Z-up</span>
      <span>
        {rootCount} object{rootCount === 1 ? '' : 's'}
      </span>
      {size && (
        <span title="Overall model size (mm)">
          {fmt(size[0])} × {fmt(size[1])} × {fmt(size[2])} mm
        </span>
      )}
      {oversize && (
        <span className="font-medium text-danger" title="Part exceeds the printer build volume">
          ⚠ Exceeds {buildVolume.x}×{buildVolume.y}×{buildVolume.z} bed
        </span>
      )}
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
