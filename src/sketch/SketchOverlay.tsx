/**
 * A 2D sketch editor that overlays the viewport. The user draws closed profiles
 * on the XY (build-plate) plane; on commit the profile is handed to Manifold's
 * CrossSection.extrude via the store's addExtrusion action — so a sketch becomes
 * an ordinary solid that participates in CSG like any primitive.
 *
 * The SVG viewBox is in millimeters (Y-up; we plot model (x,y) at svg (x,-y)),
 * so drawing, snapping, and the grid are all in real units.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vec2 } from '../document/types'
import { useSketchStore } from './sketchStore'
import type { SketchTool } from './sketchStore'
import { distance, makeCircle, makeRectangle, signedArea } from './geometry'
import { NumberField } from '../ui/NumberField'

const HALF = 120 // visible half-extent in mm (240mm window)
const CLOSE_DIST = 4 // mm: click within this of the first vertex to close a polygon
const TICKS: number[] = []
for (let v = -HALF; v <= HALF; v += 10) TICKS.push(v)

const pt = (x: number, y: number) => `${x},${-y}` // model -> svg (flip Y)
const contourPath = (c: Vec2[]) => 'M ' + c.map(([x, y]) => pt(x, y)).join(' L ') + ' Z'

const TOOLS: { id: SketchTool; label: string; hint: string }[] = [
  { id: 'rectangle', label: 'Rectangle', hint: 'Drag to draw a rectangle.' },
  { id: 'circle', label: 'Circle', hint: 'Drag from the center to set the radius.' },
  { id: 'polygon', label: 'Polygon', hint: 'Click to add points; double-click or click the first point to close.' },
]

export function SketchOverlay() {
  const tool = useSketchStore((s) => s.tool)
  const shapes = useSketchStore((s) => s.shapes)
  const draft = useSketchStore((s) => s.draft)
  const height = useSketchStore((s) => s.height)
  const setTool = useSketchStore((s) => s.setTool)
  const setHeight = useSketchStore((s) => s.setHeight)
  const addShape = useSketchStore((s) => s.addShape)
  const addDraftPoint = useSketchStore((s) => s.addDraftPoint)
  const closeDraft = useSketchStore((s) => s.closeDraft)
  const undoLast = useSketchStore((s) => s.undoLast)
  const clear = useSketchStore((s) => s.clear)
  const commit = useSketchStore((s) => s.commit)
  const cancel = useSketchStore((s) => s.cancel)

  const svgRef = useRef<SVGSVGElement>(null)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [drag, setDrag] = useState<{ start: Vec2; current: Vec2 } | null>(null)

  const canCommit = shapes.length > 0 || draft.length >= 3

  const toModel = useCallback((clientX: number, clientY: number): Vec2 => {
    const svg = svgRef.current
    const ctm = svg?.getScreenCTM()
    if (!svg || !ctm) return [0, 0]
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [Math.round(p.x), Math.round(-p.y)] // snap to 1mm, flip Y to model space
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        undoLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, commit, undoLast])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = toModel(e.clientX, e.clientY)
    if (tool === 'polygon') {
      if (draft.length >= 3 && distance(p, draft[0]) <= CLOSE_DIST) closeDraft()
      else addDraftPoint(p)
    } else {
      svgRef.current?.setPointerCapture(e.pointerId)
      setDrag({ start: p, current: p })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toModel(e.clientX, e.clientY)
    setCursor(p)
    setDrag((d) => (d ? { start: d.start, current: p } : null))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return
    svgRef.current?.releasePointerCapture?.(e.pointerId)
    const { start, current } = drag
    if (tool === 'rectangle') {
      const r = makeRectangle(start, current)
      if (Math.abs(signedArea(r)) > 1) addShape(r)
    } else if (tool === 'circle') {
      const radius = distance(start, current)
      if (radius > 0.5) addShape(makeCircle(start, radius))
    }
    setDrag(null)
  }

  const previewRect = drag && tool === 'rectangle' ? makeRectangle(drag.start, drag.current) : null
  const previewCircle =
    drag && tool === 'circle' ? { c: drag.start, r: distance(drag.start, drag.current) } : null
  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? ''

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-neutral-950">
      {/* Sub-toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-2">
        <span className="text-sm font-semibold text-neutral-100">Sketch</span>
        <div className="flex overflow-hidden rounded border border-neutral-700">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={
                'px-2.5 py-1 text-sm ' +
                (tool === t.id ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-neutral-800')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {tool === 'polygon' && (
          <button
            type="button"
            onClick={closeDraft}
            disabled={draft.length < 3}
            className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700 disabled:opacity-35"
          >
            Close shape
          </button>
        )}

        <label className="ml-2 flex items-center gap-1.5 text-sm text-neutral-400">
          Height
          <div className="w-20">
            <NumberField value={height} min={0.1} onCommit={setHeight} />
          </div>
          mm
        </label>

        <button
          type="button"
          onClick={undoLast}
          className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={clear}
          className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700"
        >
          Clear
        </button>

        <div className="flex-1" />
        <span className="hidden text-xs text-neutral-500 sm:inline">{activeHint} · Enter to extrude · Esc to cancel</span>
        <button
          type="button"
          onClick={cancel}
          className="rounded px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={commit}
          disabled={!canCommit}
          className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-35"
        >
          Extrude → Add
        </button>
      </div>

      {/* Drawing surface */}
      <div className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`${-HALF} ${-HALF} ${HALF * 2} ${HALF * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none"
          style={{ cursor: 'crosshair', background: '#0e0f13' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => tool === 'polygon' && closeDraft()}
          onPointerLeave={() => setCursor(null)}
        >
          {/* Grid */}
          {TICKS.map((v) => (
            <g key={v}>
              <line
                x1={v}
                y1={-HALF}
                x2={v}
                y2={HALF}
                stroke={v % 50 === 0 ? '#3a4253' : '#21252e'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={-HALF}
                y1={v}
                x2={HALF}
                y2={v}
                stroke={v % 50 === 0 ? '#3a4253' : '#21252e'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {/* Axes through origin */}
          <line x1={-HALF} y1={0} x2={HALF} y2={0} stroke="#ff6188" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={0} y1={-HALF} x2={0} y2={HALF} stroke="#7bd88f" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />

          {/* Completed shapes */}
          {shapes.map((c, i) => (
            <path
              key={i}
              d={contourPath(c)}
              fill="rgba(110,168,254,0.25)"
              stroke="#6ea8fe"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Draft polygon */}
          {draft.length > 0 && (
            <>
              <polyline
                points={draft.map(([x, y]) => pt(x, y)).join(' ')}
                fill="none"
                stroke="#ffd866"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
              />
              {cursor && (
                <line
                  x1={draft[draft.length - 1][0]}
                  y1={-draft[draft.length - 1][1]}
                  x2={cursor[0]}
                  y2={-cursor[1]}
                  stroke="#ffd86688"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {draft.map(([x, y], i) => (
                <circle key={i} cx={x} cy={-y} r={2} fill={i === 0 ? '#ffd866' : '#fff'} />
              ))}
            </>
          )}

          {/* Live drag preview */}
          {previewRect && (
            <path
              d={contourPath(previewRect)}
              fill="rgba(255,216,102,0.15)"
              stroke="#ffd866"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {previewCircle && previewCircle.r > 0 && (
            <circle
              cx={previewCircle.c[0]}
              cy={-previewCircle.c[1]}
              r={previewCircle.r}
              fill="rgba(255,216,102,0.15)"
              stroke="#ffd866"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Coordinate readout */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/80 px-2 py-1 font-mono text-xs text-neutral-300">
          {cursor ? `x ${cursor[0]}  y ${cursor[1]} mm` : 'XY plane · mm'}
        </div>
      </div>
    </div>
  )
}
