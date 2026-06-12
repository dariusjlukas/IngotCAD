/**
 * Sketch-mode chrome that reuses the app shell: a header toolbar, a left
 * constraint palette, and a right properties panel. The drawing surface itself
 * is SketchCanvas. Select mode is the absence of a tool (tool === null).
 */
import type { ReactNode } from 'react'
import { useSketchStore } from './sketchStore'
import type { Ref, SketchTool } from './sketchStore'
import type { ConstraintInput, PointId } from './model'
import { arcOfSegment, arcRadius, canTreatCorner, constraintLabel, cornerNeighbors } from './model'
import { distance, maxCornerSize } from './geometry'
import type { Vec2 } from '../document/types'
import { NumberField } from '../ui/NumberField'

const DRAW_TOOLS: { id: SketchTool; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'circle', label: 'Circle' },
  { id: 'arc', label: 'Arc' },
  { id: 'fillet', label: 'Fillet' },
  { id: 'chamfer', label: 'Chamfer' },
  { id: 'dimension', label: 'Dimension' },
  { id: 'project', label: 'Project' },
]

const TOOL_HINT: Record<string, string> = {
  select: 'Click to select (shift adds). Drag points to move; the sketch re-solves.',
  line: 'Click to add points; click the first point or double-click to close.',
  rectangle: 'Drag to draw a rectangle (it stays rectangular).',
  circle: 'Drag from the center to set the radius.',
  arc: 'Drag a loop segment sideways to bow it into an arc; drag it back flat to straighten.',
  fillet: 'Drag from a loop corner to round it; fine-tune the radius in Properties.',
  chamfer: 'Drag from a loop corner to bevel it; fine-tune the setback in Properties.',
  dimension:
    'Click two points or a segment (a second segment makes an angle; an arc or circle makes a radius); move to place, click, then type a value.',
  project:
    'Click a section outline (the gray in-plane cross-section of the scene) to include it as anchored sketch geometry.',
}

function Btn({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'shrink-0 rounded px-2.5 py-1 text-sm whitespace-nowrap transition-colors ' +
        (active ? 'bg-accent text-on-accent ' : 'text-fg hover:bg-elevated ') +
        'disabled:cursor-not-allowed disabled:opacity-35'
      }
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------

export function SketchToolbar() {
  const tool = useSketchStore((s) => s.tool)
  const setTool = useSketchStore((s) => s.setTool)
  const construction = useSketchStore((s) => s.construction)
  const setConstruction = useSketchStore((s) => s.setConstruction)
  const outputMode = useSketchStore((s) => s.outputMode)
  const setOutputMode = useSketchStore((s) => s.setOutputMode)
  const fitView = useSketchStore((s) => s.fitView)
  const cancel = useSketchStore((s) => s.cancel)
  const commit = useSketchStore((s) => s.commit)
  const planeLabel = useSketchStore((s) => s.planeLabel)
  // Only real (non-construction) shapes form a profile, so gate Make on those.
  const hasRealShapes = useSketchStore((s) => s.data.shapes.some((sh) => !sh.construction))

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-2 py-1.5">
      <span className="mr-1 shrink-0 select-none text-sm font-semibold text-fg-strong">
        Sketch{planeLabel ? ` · ${planeLabel}` : ''}
      </span>

      <Btn onClick={() => setTool(null)} active={tool === null} title="Select (Esc)">
        Select
      </Btn>
      {DRAW_TOOLS.map((t) => (
        <Btn
          key={t.id}
          onClick={() => setTool(tool === t.id ? null : t.id)}
          active={tool === t.id}
          title={TOOL_HINT[t.id]}
        >
          {t.label}
        </Btn>
      ))}

      <div className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
      <Btn
        onClick={() => setConstruction(!construction)}
        active={construction}
        title="Construction mode: new geometry is reference-only (snap/constrain to it, but it won't extrude)"
      >
        Construction
      </Btn>

      <div className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
      <Btn onClick={fitView} title="Fit view to sketch">
        Fit
      </Btn>

      <div className="mx-1 h-5 w-px shrink-0 bg-line-strong" />
      <span className="text-xs uppercase tracking-wide text-fg-faint">Make</span>
      <div className="flex shrink-0 overflow-hidden rounded border border-line-strong">
        {(['extrude', 'revolve'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setOutputMode(m)}
            className={
              'px-2.5 py-1 text-sm capitalize ' +
              (outputMode === m ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
            }
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex-1" />
      <span className="hidden text-xs text-fg-faint xl:inline">
        {outputMode === 'revolve'
          ? 'Revolves around the green Y axis — draw the profile to its right.'
          : TOOL_HINT[tool ?? 'select']}
      </span>
      <Btn onClick={cancel} title="Discard the sketch and return to the model">
        Cancel
      </Btn>
      <button
        type="button"
        onClick={commit}
        disabled={!hasRealShapes}
        className="shrink-0 rounded bg-accent px-3 py-1 text-sm text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
        title="Preview and place the solid"
      >
        {outputMode === 'revolve' ? 'Revolve →' : 'Extrude →'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function CBtn({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-line-strong px-2 py-1 text-left text-sm text-fg hover:bg-elevated disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}

export function SketchToolsPanel() {
  const tool = useSketchStore((s) => s.tool)
  const selection = useSketchStore((s) => s.selection)
  const data = useSketchStore((s) => s.data)
  const addConstraint = useSketchStore((s) => s.addConstraint)
  const setCircleRadius = useSketchStore((s) => s.setCircleRadius)
  const togglePointFixed = useSketchStore((s) => s.togglePointFixed)
  const toggleConstructionSelected = useSketchStore((s) => s.toggleConstructionSelected)
  const mirrorSelection = useSketchStore((s) => s.mirrorSelection)
  const clearSelection = useSketchStore((s) => s.clearSelection)

  const selPoints = selection
    .filter((r): r is Extract<Ref, { t: 'point' }> => r.t === 'point')
    .map((r) => r.id)
  const selSegs = selection.filter((r): r is Extract<Ref, { t: 'segment' }> => r.t === 'segment')
  const selCircles = selection
    .filter((r): r is Extract<Ref, { t: 'circle' }> => r.t === 'circle')
    .map((r) => r.id)
  const hasShapeSelection = selPoints.length > 0 || selSegs.length > 0 || selCircles.length > 0

  const apply = (input: ConstraintInput) => {
    addConstraint(input)
    clearSelection()
  }
  const canHV = selSegs.length === 1 || selPoints.length === 2
  const hvPair = (): [PointId, PointId] | null =>
    selSegs.length === 1
      ? [selSegs[0].a, selSegs[0].b]
      : selPoints.length === 2
        ? [selPoints[0], selPoints[1]]
        : null
  const applyHV = (kind: 'horizontal' | 'vertical') => {
    const p = hvPair()
    if (p) apply({ kind, a: p[0], b: p[1] })
  }
  const circleR = (sid: string) => {
    const s = data.shapes.find((x) => x.id === sid)
    return s && s.kind === 'circle' ? s.r : 0
  }
  const applyEqual = () => {
    if (selSegs.length === 2)
      apply({ kind: 'equal', a: selSegs[0].a, b: selSegs[0].b, c: selSegs[1].a, d: selSegs[1].b })
    else if (selCircles.length === 2) {
      const avg = (circleR(selCircles[0]) + circleR(selCircles[1])) / 2
      selCircles.forEach((sid) => setCircleRadius(sid, avg))
      clearSelection()
    }
  }
  const applyPair = (kind: 'parallel' | 'perpendicular') => {
    if (selSegs.length === 2)
      apply({ kind, a: selSegs[0].a, b: selSegs[0].b, c: selSegs[1].a, d: selSegs[1].b })
  }

  // Tangent applies to a straight segment + a circle, or a straight segment + an
  // arc segment (exactly one of two selected segments is an arc).
  const tangentTarget = (() => {
    if (selSegs.length === 1 && selCircles.length === 1) {
      if (arcOfSegment(data, selSegs[0].a, selSegs[0].b)) return null
      const s = data.shapes.find((x) => x.id === selCircles[0])
      if (!s || s.kind !== 'circle') return null
      return { line: selSegs[0], c: s.c, shape: s.id }
    }
    if (selSegs.length === 2 && selCircles.length === 0) {
      const arc0 = arcOfSegment(data, selSegs[0].a, selSegs[0].b)
      const arc1 = arcOfSegment(data, selSegs[1].a, selSegs[1].b)
      if (arc0 && !arc1) return { line: selSegs[1], c: arc0.arc.center }
      if (arc1 && !arc0) return { line: selSegs[0], c: arc1.arc.center }
    }
    return null
  })()

  const applyTangent = () => {
    if (!tangentTarget) return
    apply({
      kind: 'tangent',
      a: tangentTarget.line.a,
      b: tangentTarget.line.b,
      c: tangentTarget.c,
      ...(tangentTarget.shape && { shape: tangentTarget.shape }),
    })
  }

  const summary =
    selPoints.length || selSegs.length || selCircles.length
      ? [
          selPoints.length && `${selPoints.length} point${selPoints.length > 1 ? 's' : ''}`,
          selSegs.length && `${selSegs.length} segment${selSegs.length > 1 ? 's' : ''}`,
          selCircles.length && `${selCircles.length} circle${selCircles.length > 1 ? 's' : ''}`,
        ]
          .filter(Boolean)
          .join(', ')
      : 'nothing selected'

  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
      <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Constrain
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <p className="mb-2 text-xs text-fg-faint">{TOOL_HINT[tool ?? 'select']}</p>
        <p className="mb-2 text-xs text-fg-muted">Selected: {summary}</p>
        <div className="flex flex-col gap-1">
          <CBtn onClick={() => applyHV('horizontal')} disabled={!canHV}>
            Horizontal
          </CBtn>
          <CBtn onClick={() => applyHV('vertical')} disabled={!canHV}>
            Vertical
          </CBtn>
          <CBtn
            onClick={() =>
              selPoints.length === 2 &&
              apply({ kind: 'coincident', a: selPoints[0], b: selPoints[1] })
            }
            disabled={selPoints.length !== 2}
          >
            Coincident
          </CBtn>
          <CBtn onClick={applyEqual} disabled={selSegs.length !== 2 && selCircles.length !== 2}>
            Equal
          </CBtn>
          <CBtn onClick={() => applyPair('parallel')} disabled={selSegs.length !== 2}>
            Parallel
          </CBtn>
          <CBtn onClick={() => applyPair('perpendicular')} disabled={selSegs.length !== 2}>
            Perpendicular
          </CBtn>
          <CBtn onClick={applyTangent} disabled={!tangentTarget}>
            Tangent
          </CBtn>
          <CBtn onClick={() => togglePointFixed(selPoints)} disabled={selPoints.length === 0}>
            Fix / Unfix point
          </CBtn>
          <CBtn
            onClick={toggleConstructionSelected}
            disabled={selPoints.length === 0 && selSegs.length === 0 && selCircles.length === 0}
          >
            Toggle construction
          </CBtn>
        </div>

        <div className="mt-2 mb-1 text-xs uppercase tracking-wide text-fg-faint">
          Mirror selection
        </div>
        <div className="flex flex-col gap-1">
          <CBtn onClick={() => mirrorSelection('y')} disabled={!hasShapeSelection}>
            Across Y axis (↔)
          </CBtn>
          <CBtn onClick={() => mirrorSelection('x')} disabled={!hasShapeSelection}>
            Across X axis (↕)
          </CBtn>
        </div>

        <p className="mt-3 text-xs text-fg-faint">
          Tip: shift-click to multi-select. Use Dimension for distances.
        </p>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------

export function SketchProperties() {
  const data = useSketchStore((s) => s.data)
  const selection = useSketchStore((s) => s.selection)
  const setDimensionValue = useSketchStore((s) => s.setDimensionValue)
  const setDimensionDiameter = useSketchStore((s) => s.setDimensionDiameter)
  const setCircleRadius = useSketchStore((s) => s.setCircleRadius)
  const setArcRadius = useSketchStore((s) => s.setArcRadius)
  const setPointPos = useSketchStore((s) => s.setPointPos)
  const togglePointFixed = useSketchStore((s) => s.togglePointFixed)
  const setCornerTreatment = useSketchStore((s) => s.setCornerTreatment)
  const removeCornerTreatment = useSketchStore((s) => s.removeCornerTreatment)
  const select = useSketchStore((s) => s.select)
  const deleteSelection = useSketchStore((s) => s.deleteSelection)

  const single = selection.length === 1 ? selection[0] : null

  // When a single loop-corner point is selected, expose its fillet/chamfer
  // (not next to an arc segment — the arc owns that corner's geometry).
  const cornerInfo = (() => {
    if (!single || single.t !== 'point') return null
    if (!canTreatCorner(data, single.id)) return null
    const nb = cornerNeighbors(data, single.id)
    const p = data.points[single.id]
    if (!nb || !p) return null
    const loop = data.shapes.find((s) => s.kind === 'loop' && s.pts.includes(single.id))
    const treatment = loop && loop.kind === 'loop' ? loop.corners?.[single.id] : undefined
    return { pid: single.id, prev: nb.prev, next: nb.next, corner: [p.x, p.y] as Vec2, treatment }
  })()

  // When a single arc segment is selected, expose its derived radius.
  const arcInfo = (() => {
    if (!single || single.t !== 'segment') return null
    const found = arcOfSegment(data, single.a, single.b)
    if (!found) return null
    return { a: single.a, b: single.b, r: arcRadius(data, found.loop, found.key) }
  })()

  // A sensible starting size when turning a plain corner into a fillet/chamfer.
  const cornerDefault = (kind: 'fillet' | 'chamfer'): number => {
    if (!cornerInfo) return 1
    const max = maxCornerSize(cornerInfo.prev, cornerInfo.corner, cornerInfo.next, kind)
    const minEdge = Math.min(
      distance(cornerInfo.corner, cornerInfo.prev),
      distance(cornerInfo.corner, cornerInfo.next),
    )
    return Math.min(max, Math.max(1, minEdge * 0.25))
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Properties
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {single &&
          single.t === 'constraint' &&
          (() => {
            const c = data.constraints.find((x) => x.id === single.id)
            if (!c) return null
            if (c.kind === 'distance')
              return (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">
                    Dimension
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-faint">Value (mm)</span>
                    <div className="w-20">
                      <NumberField
                        value={c.value}
                        min={0.01}
                        onCommit={(v) => setDimensionValue(c.id, v)}
                      />
                    </div>
                  </label>
                </div>
              )
            if (c.kind === 'radius')
              return (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">
                    Radius dimension
                  </div>
                  <div className="mb-2 flex overflow-hidden rounded border border-line-strong">
                    {(['R', '⌀'] as const).map((m) => {
                      const isDia = m === '⌀'
                      const active = Boolean(c.diameter) === isDia
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDimensionDiameter(c.id, isDia)}
                          className={
                            'flex-1 px-2 py-1 text-xs ' +
                            (active
                              ? 'bg-accent text-on-accent'
                              : 'text-fg-muted hover:bg-elevated')
                          }
                        >
                          {m}
                        </button>
                      )
                    })}
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-faint">
                      {c.diameter ? '⌀ (mm)' : 'R (mm)'}
                    </span>
                    <div className="w-20">
                      <NumberField
                        value={c.diameter ? c.value * 2 : c.value}
                        min={0.1}
                        onCommit={(v) => setDimensionValue(c.id, v)}
                      />
                    </div>
                  </label>
                </div>
              )
            if (c.kind === 'angle')
              return (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">
                    Angle dimension
                  </div>
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-faint">Value (°)</span>
                    <div className="w-20">
                      <NumberField
                        value={c.value}
                        min={0.5}
                        onCommit={(v) => setDimensionValue(c.id, v)}
                      />
                    </div>
                  </label>
                </div>
              )
            return null
          })()}

        {arcInfo && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">Arc</div>
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-faint">Radius (mm)</span>
              <div className="w-20">
                <NumberField
                  value={arcInfo.r}
                  min={0.1}
                  onCommit={(r) => setArcRadius(arcInfo.a, arcInfo.b, r)}
                />
              </div>
            </label>
          </div>
        )}

        {single && single.t === 'point' && data.points[single.id] && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">Point</div>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-fg-faint">X</span>
              <div className="w-20">
                <NumberField
                  value={data.points[single.id].x}
                  onCommit={(x) => setPointPos(single.id, x, data.points[single.id].y)}
                />
              </div>
            </label>
            <label className="flex items-center justify-between gap-2 py-0.5">
              <span className="text-xs text-fg-faint">Y</span>
              <div className="w-20">
                <NumberField
                  value={data.points[single.id].y}
                  onCommit={(y) => setPointPos(single.id, data.points[single.id].x, y)}
                />
              </div>
            </label>
            <button
              type="button"
              onClick={() => togglePointFixed([single.id])}
              className="mt-1 w-full rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-elevated"
            >
              {data.points[single.id].fixed ? 'Unfix point' : 'Fix point (anchor)'}
            </button>
          </div>
        )}

        {cornerInfo && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">Corner</div>
            <div className="mb-2 flex overflow-hidden rounded border border-line-strong">
              {(['none', 'fillet', 'chamfer'] as const).map((k) => {
                const active = (cornerInfo.treatment?.kind ?? 'none') === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      k === 'none'
                        ? removeCornerTreatment(cornerInfo.pid)
                        : setCornerTreatment(
                            cornerInfo.pid,
                            k,
                            cornerInfo.treatment?.size ?? cornerDefault(k),
                          )
                    }
                    className={
                      'flex-1 px-2 py-1 text-xs capitalize ' +
                      (active ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
                    }
                  >
                    {k}
                  </button>
                )
              })}
            </div>
            {cornerInfo.treatment &&
              (() => {
                const t = cornerInfo.treatment
                const max = maxCornerSize(
                  cornerInfo.prev,
                  cornerInfo.corner,
                  cornerInfo.next,
                  t.kind,
                )
                return (
                  <label className="flex items-center justify-between gap-2">
                    <span className="text-xs text-fg-faint">
                      {t.kind === 'fillet' ? 'Radius (mm)' : 'Setback (mm)'}
                    </span>
                    <div className="w-20">
                      <NumberField
                        value={t.size}
                        min={0.1}
                        onCommit={(v) =>
                          setCornerTreatment(cornerInfo.pid, t.kind, Math.min(max, v))
                        }
                      />
                    </div>
                  </label>
                )
              })()}
          </div>
        )}

        {single &&
          single.t === 'circle' &&
          (() => {
            const s = data.shapes.find((x) => x.id === single.id)
            if (!s || s.kind !== 'circle') return null
            return (
              <div>
                <div className="mb-1 text-xs uppercase tracking-wide text-fg-faint">Circle</div>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs text-fg-faint">⌀ (mm)</span>
                  <div className="w-20">
                    <NumberField
                      value={s.r * 2}
                      min={0.1}
                      onCommit={(d) => setCircleRadius(s.id, d / 2)}
                    />
                  </div>
                </label>
              </div>
            )
          })()}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              Constraints ({data.constraints.length})
            </span>
            {selection.length > 0 && (
              <button
                type="button"
                onClick={deleteSelection}
                className="text-xs text-danger hover:underline"
              >
                Delete sel.
              </button>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {data.constraints.length === 0 && (
              <span className="text-xs text-fg-faint">none yet</span>
            )}
            {data.constraints.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select([{ t: 'constraint', id: c.id }])}
                className={
                  'rounded px-1.5 py-0.5 text-left text-xs ' +
                  (selection.some((r) => r.t === 'constraint' && r.id === c.id)
                    ? 'bg-selection text-on-accent'
                    : 'text-fg-muted hover:bg-elevated')
                }
              >
                {constraintLabel(c)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
