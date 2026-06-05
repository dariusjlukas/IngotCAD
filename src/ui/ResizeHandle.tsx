/** A draggable vertical divider that resizes an adjacent fixed-width panel. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

export function ResizeHandle({
  width,
  onResize,
  direction,
  min = 160,
  max = 480,
}: {
  width: number
  onResize: (width: number) => void
  /** +1 when the panel is to the left of the handle, -1 when it is to the right. */
  direction: 1 | -1
  min?: number
  max?: number
}) {
  const [dragging, setDragging] = useState(false)
  // Keep the latest callback without re-binding window listeners mid-drag.
  const onResizeRef = useRef(onResize)
  useEffect(() => {
    onResizeRef.current = onResize
  })

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault()
      setDragging(true)
      const startX = e.clientX
      const startWidth = width
      const onMove = (ev: PointerEvent) => {
        const next = startWidth + direction * (ev.clientX - startX)
        onResizeRef.current(Math.min(max, Math.max(min, next)))
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setDragging(false)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width, direction, min, max],
  )

  return (
    <div className="group relative z-10 w-px shrink-0 bg-line">
      {/* Thin centered highlight: lit while hovering, and held lit for the whole drag. */}
      <div
        className={
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ' +
          (dragging ? 'bg-accent-ring/60' : 'group-hover:bg-accent-ring/60')
        }
      />
      {/* Wide invisible hit area so the thin line is still easy to grab. */}
      <div
        onPointerDown={onPointerDown}
        className="absolute inset-y-0 -left-1 -right-1 cursor-col-resize"
      />
    </div>
  )
}
