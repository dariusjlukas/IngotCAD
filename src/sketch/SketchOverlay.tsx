/**
 * A 2D sketch editor that overlays the viewport. The user draws parametric
 * shapes on the XY (build-plate) plane; on commit each shape's contour is handed
 * to Manifold's CrossSection.extrude (via the store), so a sketch becomes an
 * ordinary solid that participates in CSG like any primitive.
 *
 * The SVG viewBox is in millimeters (Y-up; model (x,y) is plotted at svg (x,-y))
 * and is panned/zoomed via `view`. Shapes carry their parameters so dimensions
 * can be shown and edited (the "parametric" part).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Vec2 } from '../document/types'
import { useSketchStore } from './sketchStore'
import type { SketchTool } from './sketchStore'
import type { SketchShape } from './shapes'
import { pointInShape, shapeToContour, translateShape } from './shapes'
import { distance, niceStep } from './geometry'
import { NumberField } from '../ui/NumberField'

const CLOSE_DIST = 4 // mm: click within this of the first vertex to close a polygon

const pt = (x: number, y: number) => `${x},${-y}` // model -> svg (flip Y)
const contourPath = (c: Vec2[]) => 'M ' + c.map(([x, y]) => pt(x, y)).join(' L ') + ' Z'
const r1 = (n: number) => Math.round(n * 100) / 100

interface View {
  cx: number
  cy: number
  size: number
}

const DEFAULT_VIEW: View = { cx: 0, cy: 0, size: 240 }

const TOOLS: { id: SketchTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Select', hint: 'Click a shape to edit its dimensions; drag to move.' },
  { id: 'rectangle', label: 'Rectangle', hint: 'Drag to draw a rectangle.' },
  { id: 'circle', label: 'Circle', hint: 'Drag from the center to set the radius.' },
  { id: 'polygon', label: 'Polygon', hint: 'Click to add points; double-click or click the first point to close.' },
]

function ParamRow({
  label,
  value,
  min,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  onCommit: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <div className="w-20">
        <NumberField value={value} min={min} onCommit={onCommit} />
      </div>
    </label>
  )
}

export function SketchOverlay() {
  const tool = useSketchStore((s) => s.tool)
  const shapes = useSketchStore((s) => s.shapes)
  const draft = useSketchStore((s) => s.draft)
  const selectedIndex = useSketchStore((s) => s.selectedIndex)
  const height = useSketchStore((s) => s.height)
  const setTool = useSketchStore((s) => s.setTool)
  const setHeight = useSketchStore((s) => s.setHeight)
  const addShape = useSketchStore((s) => s.addShape)
  const updateShape = useSketchStore((s) => s.updateShape)
  const selectShape = useSketchStore((s) => s.selectShape)
  const deleteSelected = useSketchStore((s) => s.deleteSelected)
  const addDraftPoint = useSketchStore((s) => s.addDraftPoint)
  const closeDraft = useSketchStore((s) => s.closeDraft)
  const undoLast = useSketchStore((s) => s.undoLast)
  const clear = useSketchStore((s) => s.clear)
  const commit = useSketchStore((s) => s.commit)
  const cancel = useSketchStore((s) => s.cancel)

  const svgRef = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>(DEFAULT_VIEW)
  const [cursor, setCursor] = useState<Vec2 | null>(null)
  const [drag, setDrag] = useState<{ start: Vec2; current: Vec2 } | null>(null)
  const panRef = useRef<{ sx: number; sy: number; cx0: number; cy0: number; scale: number } | null>(null)
  const moveRef = useRef<{ index: number; start: Vec2; original: SketchShape } | null>(null)

  const canCommit = shapes.length > 0 || draft.length >= 3
  const selected = selectedIndex != null ? shapes[selectedIndex] : null

  const toModelRaw = useCallback((clientX: number, clientY: number): Vec2 => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return [0, 0]
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
    return [p.x, -p.y]
  }, [])

  const toModel = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const [x, y] = toModelRaw(clientX, clientY)
      return [Math.round(x), Math.round(y)] // snap to 1mm
    },
    [toModelRaw],
  )

  // Wheel zoom toward the cursor (native, non-passive so we can preventDefault).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = toModelRaw(e.clientX, e.clientY)
      setView((v) => {
        const factor = e.deltaY < 0 ? 0.9 : 1.1
        const size = Math.min(4000, Math.max(5, v.size * factor))
        const k = size / v.size
        return { cx: px + (v.cx - px) * k, cy: py + (v.cy - py) * k, size }
      })
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [toModelRaw])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commit()
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        if (useSketchStore.getState().selectedIndex != null) deleteSelected()
        else undoLast()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, commit, undoLast, deleteSelected])

  const fitView = () => {
    const all: Vec2[] = []
    shapes.forEach((s) => shapeToContour(s).forEach((p) => all.push(p)))
    draft.forEach((p) => all.push(p))
    if (all.length === 0) {
      setView(DEFAULT_VIEW)
      return
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of all) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const extent = Math.max(maxX - minX, maxY - minY, 10)
    setView({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, size: extent * 1.4 })
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
      const ctm = svgRef.current?.getScreenCTM()
      if (ctm) {
        panRef.current = { sx: e.clientX, sy: e.clientY, cx0: view.cx, cy0: view.cy, scale: ctm.a }
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }
    if (e.button !== 0) return
    const p = toModel(e.clientX, e.clientY)

    if (tool === 'select') {
      let hit: number | null = null
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (pointInShape(shapes[i], p)) {
          hit = i
          break
        }
      }
      selectShape(hit)
      if (hit != null) {
        moveRef.current = { index: hit, start: p, original: shapes[hit] }
        svgRef.current?.setPointerCapture(e.pointerId)
      }
      return
    }

    if (tool === 'polygon') {
      if (draft.length >= 3 && distance(p, draft[0]) <= CLOSE_DIST) closeDraft()
      else addDraftPoint(p)
      return
    }

    // rectangle / circle: begin a drag
    setDrag({ start: p, current: p })
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const { sx, sy, cx0, cy0, scale } = panRef.current
      setView((v) => ({ ...v, cx: cx0 - (e.clientX - sx) / scale, cy: cy0 + (e.clientY - sy) / scale }))
      return
    }
    const p = toModel(e.clientX, e.clientY)
    setCursor(p)
    if (moveRef.current) {
      const { index, start, original } = moveRef.current
      updateShape(index, translateShape(original, p[0] - start[0], p[1] - start[1]))
      return
    }
    if (drag) setDrag({ start: drag.start, current: p })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    svgRef.current?.releasePointerCapture?.(e.pointerId)
    if (panRef.current) {
      panRef.current = null
      return
    }
    if (moveRef.current) {
      moveRef.current = null
      return
    }
    if (drag) {
      const { start, current } = drag
      if (tool === 'rectangle') {
        const x = Math.min(start[0], current[0])
        const y = Math.min(start[1], current[1])
        const w = Math.abs(current[0] - start[0])
        const h = Math.abs(current[1] - start[1])
        if (w > 0.5 && h > 0.5) addShape({ kind: 'rect', x, y, w, h })
      } else if (tool === 'circle') {
        const r = distance(start, current)
        if (r > 0.5) addShape({ kind: 'circle', cx: start[0], cy: start[1], r })
      }
      setDrag(null)
    }
  }

  // Grid + axes for the visible region.
  const grid = useMemo(() => {
    const { cx, cy, size } = view
    const left = cx - size / 2
    const right = cx + size / 2
    const bottom = cy - size / 2
    const top = cy + size / 2
    const step = niceStep(size)
    const verticals: { v: number; major: boolean }[] = []
    const horizontals: { v: number; major: boolean }[] = []
    for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
      verticals.push({ v: x, major: Math.round(x / step) % 5 === 0 })
    }
    for (let y = Math.ceil(bottom / step) * step; y <= top; y += step) {
      horizontals.push({ v: y, major: Math.round(y / step) % 5 === 0 })
    }
    return { left, right, bottom, top, verticals, horizontals }
  }, [view])

  const fontSize = view.size * 0.03
  const dimOffset = view.size * 0.04
  const vertexR = view.size * 0.009

  const previewRect =
    drag && tool === 'rectangle'
      ? {
          x: Math.min(drag.start[0], drag.current[0]),
          y: Math.min(drag.start[1], drag.current[1]),
          w: Math.abs(drag.current[0] - drag.start[0]),
          h: Math.abs(drag.current[1] - drag.start[1]),
        }
      : null
  const previewCircle = drag && tool === 'circle' ? { c: drag.start, r: distance(drag.start, drag.current) } : null
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

        <button type="button" onClick={fitView} className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
          Fit
        </button>
        <button type="button" onClick={undoLast} className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
          Undo
        </button>
        <button type="button" onClick={clear} className="rounded px-2 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
          Clear
        </button>

        <div className="flex-1" />
        <span className="hidden text-xs text-neutral-500 lg:inline">
          {activeHint} · scroll to zoom · middle/right-drag to pan · Enter to extrude
        </span>
        <button type="button" onClick={cancel} className="rounded px-3 py-1 text-sm text-neutral-200 hover:bg-neutral-700">
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
          viewBox={`${view.cx - view.size / 2} ${-view.cy - view.size / 2} ${view.size} ${view.size}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none"
          style={{ cursor: tool === 'select' ? 'default' : 'crosshair', background: '#0e0f13' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => tool === 'polygon' && closeDraft()}
          onPointerLeave={() => setCursor(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Grid */}
          {grid.verticals.map(({ v, major }) => (
            <line
              key={`v${v}`}
              x1={v}
              y1={-grid.bottom}
              x2={v}
              y2={-grid.top}
              stroke={major ? '#3a4253' : '#1e222b'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {grid.horizontals.map(({ v, major }) => (
            <line
              key={`h${v}`}
              x1={grid.left}
              y1={-v}
              x2={grid.right}
              y2={-v}
              stroke={major ? '#3a4253' : '#1e222b'}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* Axes */}
          {grid.bottom <= 0 && grid.top >= 0 && (
            <line x1={grid.left} y1={0} x2={grid.right} y2={0} stroke="#ff6188" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}
          {grid.left <= 0 && grid.right >= 0 && (
            <line x1={0} y1={-grid.bottom} x2={0} y2={-grid.top} stroke="#7bd88f" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          )}

          {/* Completed shapes */}
          {shapes.map((shape, i) => {
            const isSel = i === selectedIndex
            const stroke = isSel ? '#ffd866' : '#6ea8fe'
            const fill = isSel ? 'rgba(255,216,102,0.18)' : 'rgba(110,168,254,0.22)'
            return (
              <g key={i}>
                {shape.kind === 'circle' ? (
                  <circle
                    cx={shape.cx}
                    cy={-shape.cy}
                    r={shape.r}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <path d={contourPath(shapeToContour(shape))} fill={fill} stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                )}
              </g>
            )
          })}

          {/* Dimension labels */}
          {shapes.map((shape, i) => (
            <ShapeDimensions key={`d${i}`} shape={shape} selected={i === selectedIndex} fontSize={fontSize} offset={dimOffset} />
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
                <circle key={i} cx={x} cy={-y} r={vertexR} fill={i === 0 ? '#ffd866' : '#fff'} />
              ))}
            </>
          )}

          {/* Live drag preview */}
          {previewRect && previewRect.w > 0 && (
            <path
              d={contourPath([
                [previewRect.x, previewRect.y],
                [previewRect.x + previewRect.w, previewRect.y],
                [previewRect.x + previewRect.w, previewRect.y + previewRect.h],
                [previewRect.x, previewRect.y + previewRect.h],
              ])}
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

        {/* Parameter panel for the selected shape */}
        {selected && selectedIndex != null && (
          <div className="absolute right-2 top-2 w-44 rounded border border-neutral-700 bg-neutral-900/95 p-2 shadow-lg">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium capitalize text-neutral-100">{selected.kind}</span>
              <button
                type="button"
                onClick={deleteSelected}
                title="Delete shape"
                className="rounded px-1 text-neutral-400 hover:bg-neutral-700 hover:text-rose-300"
              >
                Delete
              </button>
            </div>
            <ShapeParams shape={selected} onChange={(s) => updateShape(selectedIndex, s)} />
          </div>
        )}

        {/* Coordinate readout */}
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-neutral-900/80 px-2 py-1 font-mono text-xs text-neutral-300">
          {cursor ? `x ${cursor[0]}  y ${cursor[1]} mm` : 'XY plane · mm'}
        </div>
      </div>
    </div>
  )
}

function ShapeParams({ shape, onChange }: { shape: SketchShape; onChange: (s: SketchShape) => void }) {
  let rows: ReactNode
  switch (shape.kind) {
    case 'rect':
      rows = (
        <>
          <ParamRow label="X" value={shape.x} onCommit={(x) => onChange({ ...shape, x })} />
          <ParamRow label="Y" value={shape.y} onCommit={(y) => onChange({ ...shape, y })} />
          <ParamRow label="W" min={0.1} value={shape.w} onCommit={(w) => onChange({ ...shape, w })} />
          <ParamRow label="H" min={0.1} value={shape.h} onCommit={(h) => onChange({ ...shape, h })} />
        </>
      )
      break
    case 'circle':
      rows = (
        <>
          <ParamRow label="X" value={shape.cx} onCommit={(cx) => onChange({ ...shape, cx })} />
          <ParamRow label="Y" value={shape.cy} onCommit={(cy) => onChange({ ...shape, cy })} />
          <ParamRow label="⌀" min={0.1} value={shape.r * 2} onCommit={(d) => onChange({ ...shape, r: d / 2 })} />
        </>
      )
      break
    case 'polygon':
      rows = <p className="text-xs text-neutral-500">{shape.points.length} points (not editable yet)</p>
      break
  }
  return <div>{rows}</div>
}

function ShapeDimensions({
  shape,
  selected,
  fontSize,
  offset,
}: {
  shape: SketchShape
  selected: boolean
  fontSize: number
  offset: number
}) {
  const text = (x: number, y: number, value: string, anchor: 'middle' | 'end' = 'middle') => (
    <text x={x} y={-y} fontSize={fontSize} fill="#cbd5e1" textAnchor={anchor} dominantBaseline="middle">
      {value}
    </text>
  )

  if (shape.kind === 'rect') {
    return (
      <g>
        {text(shape.x + shape.w / 2, shape.y - offset, `${r1(shape.w)}`)}
        {text(shape.x - offset, shape.y + shape.h / 2, `${r1(shape.h)}`, 'end')}
      </g>
    )
  }
  if (shape.kind === 'circle') {
    return text(shape.cx, shape.cy, `⌀${r1(shape.r * 2)}`)
  }
  // polygon: edge lengths only when selected (avoids clutter)
  if (!selected) return null
  return (
    <g>
      {shape.points.map((p, i) => {
        const q = shape.points[(i + 1) % shape.points.length]
        const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
        return <g key={i}>{text(mid[0], mid[1], `${r1(distance(p, q))}`)}</g>
      })}
    </g>
  )
}
