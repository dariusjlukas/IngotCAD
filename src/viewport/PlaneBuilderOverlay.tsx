/**
 * Shown over the viewport while building a construction plane by picking
 * geometry. Mirrors PlanePicker's floating bar: an instruction, live progress
 * for the three-points tool, and Cancel (Escape also cancels).
 */
import { useEffect } from 'react'
import { usePlaneBuilderStore } from './planeBuilderStore'
import type { PlaneTool } from './planeBuilderStore'

const HINT: Record<PlaneTool, string> = {
  face: 'Click a face to place a plane parallel to it.',
  threePoints: 'Click three points to define a plane.',
  edgeAngle: 'Click near an edge to hinge a plane on it (set the angle in Properties).',
}

export function PlaneBuilderOverlay() {
  const tool = usePlaneBuilderStore((s) => s.tool)
  const points = usePlaneBuilderStore((s) => s.points)
  const cancel = usePlaneBuilderStore((s) => s.cancel)

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

  if (!tool) return null
  const progress = tool === 'threePoints' ? ` (${points.length}/3)` : ''

  return (
    <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line-strong bg-panel/95 px-3 py-2 shadow-xl">
      <span className="text-sm font-medium text-fg">
        New construction plane — {HINT[tool]}
        {progress}
      </span>
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
