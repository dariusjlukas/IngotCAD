/** Edits the selected node: name, color, transform, shape params, and role. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_PATTERN_SPEC, useCadStore, worldScale } from '../document/store'
import { useSketchStore } from '../sketch/sketchStore'
import { textToContours } from '../text/font'
import { toast } from './toastStore'
import { primitiveLocalDimensions } from '../document/scaleBake'
import type {
  PatternMode,
  PatternNode,
  PatternSpec,
  PlaneDefinition,
  PrimitiveNode,
  PrimitiveParams,
  ShellNode,
  Vec3,
} from '../document/types'
import { NumberField, Vec3Field } from './NumberField'

const PLANE_KIND_LABEL: Record<PlaneDefinition['kind'], string> = {
  offset: 'Offset from a cardinal plane',
  face: 'Offset from a face',
  threePoints: 'Through three points',
  edgeAngle: 'Angle about an edge',
}

/** True when a scale axis meaningfully differs from 1. */
function scaled(x: number): boolean {
  return Math.abs(x - 1) > 1e-4
}

/** Trim to at most 2 decimals without trailing zeros (e.g. 20, 20.5, 19.99). */
function fmtMm(n: number): string {
  return String(Number(n.toFixed(2)))
}

function EditSketchButton({ nodeId }: { nodeId: string }) {
  const editSketch = useSketchStore((s) => s.editSketch)
  return (
    <button
      type="button"
      onClick={() => editSketch(nodeId)}
      className="w-full rounded bg-accent px-2 py-1 text-xs text-on-accent hover:bg-accent-hover"
    >
      ✎ Edit Sketch
    </button>
  )
}

/** The fixed-width panel chrome. Declared at module scope (not inside
 * PropertyEditor) so it isn't recreated each render. */
function PropertyShell({ width, children }: { width: number; children: ReactNode }) {
  return (
    <aside className="flex shrink-0 flex-col bg-panel" style={{ width }}>
      <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Properties
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-fg-faint">{label}</span>
      <div className="w-24">{children}</div>
    </label>
  )
}

/** A text input that commits on blur / Enter (so editing is one undo step). */
function TextParamInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(value)
  }, [value])
  return (
    <input
      value={text}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false
        if (text !== value) onCommit(text)
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="w-full rounded bg-elevated px-2 py-1 text-sm text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
    />
  )
}

function TextEditor({
  node,
  params,
}: {
  node: PrimitiveNode
  params: Extract<PrimitiveParams, { type: 'text' }>
}) {
  const setNodeParams = useCadStore((s) => s.setNodeParams)
  // Re-typing / re-sizing regenerates the glyph profile via the font (async).
  // Re-read the live height so a concurrent depth edit isn't clobbered.
  const regen = (text: string, size: number) => {
    textToContours(text, size)
      .then((profile) => {
        if (profile.length === 0) return
        const cur = useCadStore.getState().doc.nodes[node.id]
        if (cur?.kind !== 'primitive' || cur.params.type !== 'text') return
        setNodeParams(node.id, { type: 'text', text, size, height: cur.params.height, profile })
      })
      .catch(() => toast.error('Could not render text.'))
  }
  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        <span className="text-xs text-fg-faint">Text</span>
        <TextParamInput value={params.text} onCommit={(text) => regen(text, params.size)} />
      </div>
      <Field label="Size (mm)">
        <NumberField value={params.size} min={1} onCommit={(size) => regen(params.text, size)} />
      </Field>
      <Field label="Depth (mm)">
        <NumberField
          value={params.height}
          min={0.1}
          live
          onCommit={(height) => setNodeParams(node.id, { ...params, height })}
        />
      </Field>
    </div>
  )
}

function PrimitiveParamsEditor({ node }: { node: PrimitiveNode }) {
  const setNodeParams = useCadStore((s) => s.setNodeParams)
  const params = node.params
  const update = (next: PrimitiveParams) => setNodeParams(node.id, next)

  switch (params.type) {
    case 'box':
      return (
        <Vec3Field
          label="Size (mm)"
          value={params.size}
          min={0.1}
          step={1}
          live
          onCommit={(size) => update({ ...params, size })}
        />
      )
    case 'cylinder':
      return (
        <div className="space-y-1.5">
          <Field label="Height">
            <NumberField
              value={params.height}
              min={0.1}
              live
              onCommit={(height) => update({ ...params, height })}
            />
          </Field>
          <Field label="Radius ⌀ bottom">
            <NumberField
              value={params.radiusBottom}
              min={0}
              live
              onCommit={(radiusBottom) => update({ ...params, radiusBottom })}
            />
          </Field>
          <Field label="Radius ⌀ top">
            <NumberField
              value={params.radiusTop}
              min={0}
              live
              onCommit={(radiusTop) => update({ ...params, radiusTop })}
            />
          </Field>
          <Field label="Sides">
            <NumberField
              value={params.segments}
              min={3}
              step={1}
              live
              onCommit={(segments) => update({ ...params, segments: Math.round(segments) })}
            />
          </Field>
        </div>
      )
    case 'sphere':
      return (
        <div className="space-y-1.5">
          <Field label="Radius">
            <NumberField
              value={params.radius}
              min={0.1}
              live
              onCommit={(radius) => update({ ...params, radius })}
            />
          </Field>
          <Field label="Segments">
            <NumberField
              value={params.segments}
              min={4}
              step={1}
              live
              onCommit={(segments) => update({ ...params, segments: Math.round(segments) })}
            />
          </Field>
        </div>
      )
    case 'extrusion':
      return (
        <div className="space-y-1.5">
          <Field label="Height">
            <NumberField
              value={params.height}
              min={0.1}
              live
              onCommit={(height) => update({ ...params, height })}
            />
          </Field>
          <button
            type="button"
            onClick={() => update({ ...params, flip: !params.flip })}
            className="w-full rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-elevated"
          >
            Direction: {params.flip ? 'flipped (−)' : 'normal (+)'}
          </button>
          {params.sketch && <EditSketchButton nodeId={node.id} />}
        </div>
      )
    case 'revolution':
      return (
        <div className="space-y-1.5">
          <Field label="Angle (°)">
            <NumberField
              value={params.degrees}
              min={1}
              live
              onCommit={(degrees) => update({ ...params, degrees: Math.min(360, degrees) })}
            />
          </Field>
          <Field label="Segments">
            <NumberField
              value={params.segments}
              min={3}
              step={1}
              live
              onCommit={(segments) => update({ ...params, segments: Math.round(segments) })}
            />
          </Field>
          {params.sketch && <EditSketchButton nodeId={node.id} />}
        </div>
      )
    case 'text':
      return <TextEditor node={node} params={params} />
    case 'mesh':
      return <p className="text-xs text-fg-faint">Imported mesh — no editable parameters.</p>
  }
}

const PATTERN_MODE_LABEL: Record<PatternMode, string> = {
  linear: 'Linear',
  circular: 'Circular',
  mirror: 'Mirror',
}

const UNIT_AXES: { key: string; vec: Vec3 }[] = [
  { key: 'X', vec: [1, 0, 0] },
  { key: 'Y', vec: [0, 1, 0] },
  { key: 'Z', vec: [0, 0, 1] },
]

/** Quick X/Y/Z buttons for picking an axis/normal direction (the common case). */
function AxisButtons({ value, onPick }: { value: Vec3; onPick: (axis: Vec3) => void }) {
  const abs = value.map(Math.abs)
  const dominant = abs.indexOf(Math.max(...abs))
  return (
    <div className="flex overflow-hidden rounded border border-line-strong">
      {UNIT_AXES.map(({ key, vec }, i) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(vec)}
          className={
            'px-2.5 py-0.5 text-xs ' +
            (dominant === i ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
          }
        >
          {key}
        </button>
      ))}
    </div>
  )
}

function MiniButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded border border-line-strong px-2 py-0.5 text-xs hover:bg-elevated"
    >
      {children}
    </button>
  )
}

function PatternEditor({ node }: { node: PatternNode }) {
  const setPatternSpec = useCadStore((s) => s.setPatternSpec)
  const spec = node.spec
  const setSpec = (next: PatternSpec) => setPatternSpec(node.id, next)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-faint">Type</span>
        <div className="flex overflow-hidden rounded border border-line-strong">
          {(['linear', 'circular', 'mirror'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => spec.mode !== m && setSpec(DEFAULT_PATTERN_SPEC[m])}
              className={
                'px-2 py-0.5 text-xs ' +
                (spec.mode === m ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
              }
            >
              {PATTERN_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {spec.mode === 'linear' && (
        <div className="space-y-1.5">
          <Field label="Count">
            <NumberField
              value={spec.count}
              min={1}
              step={1}
              live
              onCommit={(count) => setSpec({ ...spec, count: Math.round(count) })}
            />
          </Field>
          <Vec3Field
            label="Spacing (mm)"
            value={spec.offset}
            step={1}
            live
            onCommit={(offset) => setSpec({ ...spec, offset })}
          />
        </div>
      )}

      {spec.mode === 'circular' && (
        <div className="space-y-1.5">
          <Field label="Count">
            <NumberField
              value={spec.count}
              min={1}
              step={1}
              live
              onCommit={(count) => setSpec({ ...spec, count: Math.round(count) })}
            />
          </Field>
          <Field label="Angle (°)">
            <NumberField
              value={spec.angleDeg}
              min={1}
              step={5}
              live
              onCommit={(angleDeg) => setSpec({ ...spec, angleDeg: Math.min(360, angleDeg) })}
            />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-faint">Axis</span>
            <AxisButtons value={spec.axisDir} onPick={(axisDir) => setSpec({ ...spec, axisDir })} />
          </div>
          <Vec3Field
            label="Axis point (mm)"
            value={spec.axisOrigin}
            step={1}
            live
            onCommit={(axisOrigin) => setSpec({ ...spec, axisOrigin })}
          />
        </div>
      )}

      {spec.mode === 'mirror' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-faint">Across</span>
            <AxisButtons
              value={spec.planeNormal}
              onPick={(planeNormal) => setSpec({ ...spec, planeNormal })}
            />
          </div>
          <Vec3Field
            label="Plane point (mm)"
            value={spec.planeOrigin}
            step={1}
            live
            onCommit={(planeOrigin) => setSpec({ ...spec, planeOrigin })}
          />
          <MiniButton onClick={() => setSpec({ ...spec, keepOriginal: !spec.keepOriginal })}>
            {spec.keepOriginal ? 'Keep original + mirror' : 'Mirror only'}
          </MiniButton>
        </div>
      )}
    </div>
  )
}

function ShellEditor({ node }: { node: ShellNode }) {
  const setShellParams = useCadStore((s) => s.setShellParams)
  return (
    <div className="space-y-1.5">
      <Field label="Wall (mm)">
        <NumberField
          value={node.thickness}
          min={0.1}
          live
          onCommit={(thickness) => setShellParams(node.id, thickness, node.openTop)}
        />
      </Field>
      <MiniButton onClick={() => setShellParams(node.id, node.thickness, !node.openTop)}>
        Top: {node.openTop ? 'open' : 'closed'}
      </MiniButton>
    </div>
  )
}

function PlaneEditor({ width, planeId }: { width: number; planeId: string }) {
  const plane = useCadStore((s) => s.doc.planes[planeId])
  const renamePlane = useCadStore((s) => s.renamePlane)
  const setPlaneDefinition = useCadStore((s) => s.setPlaneDefinition)
  const setPlaneVisible = useCadStore((s) => s.setPlaneVisible)
  const deletePlane = useCadStore((s) => s.deletePlane)

  if (!plane) {
    return (
      <PropertyShell width={width}>
        <p className="text-sm text-fg-faint">Select something to edit it.</p>
      </PropertyShell>
    )
  }

  const def = plane.definition
  return (
    <PropertyShell width={width}>
      <div className="space-y-4">
        <input
          value={plane.name}
          onChange={(e) => renamePlane(planeId, e.target.value)}
          className="w-full rounded bg-elevated px-2 py-1 text-sm text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
        />
        <div className="text-xs text-fg-faint">{PLANE_KIND_LABEL[def.kind]}</div>

        {def.kind === 'offset' && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-faint">Base</span>
              <div className="flex overflow-hidden rounded border border-line-strong">
                {(['xy', 'xz', 'yz'] as const).map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setPlaneDefinition(planeId, { ...def, base: b })}
                    className={
                      'px-2 py-0.5 text-xs uppercase ' +
                      (def.base === b
                        ? 'bg-accent text-on-accent'
                        : 'text-fg-muted hover:bg-elevated')
                    }
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Offset (mm)">
              <NumberField
                value={def.distance}
                step={1}
                live
                onCommit={(distance) => setPlaneDefinition(planeId, { ...def, distance })}
              />
            </Field>
          </div>
        )}

        {def.kind === 'face' && (
          <Field label="Offset (mm)">
            <NumberField
              value={def.distance}
              step={1}
              live
              onCommit={(distance) => setPlaneDefinition(planeId, { ...def, distance })}
            />
          </Field>
        )}

        {def.kind === 'edgeAngle' && (
          <Field label="Angle (°)">
            <NumberField
              value={def.angleDeg}
              step={5}
              live
              onCommit={(angleDeg) => setPlaneDefinition(planeId, { ...def, angleDeg })}
            />
          </Field>
        )}

        {def.kind === 'threePoints' && (
          <p className="text-xs text-fg-faint">Defined by three picked points.</p>
        )}

        <div className="flex gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setPlaneVisible(planeId, !plane.visible)}
            className="flex-1 rounded border border-line-strong px-2 py-1 text-xs hover:bg-elevated"
          >
            {plane.visible ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            onClick={() => deletePlane(planeId)}
            className="flex-1 rounded border border-line-strong px-2 py-1 text-xs text-danger hover:bg-elevated"
          >
            Delete
          </button>
        </div>
      </div>
    </PropertyShell>
  )
}

export function PropertyEditor({ width }: { width: number }) {
  const planeId = useCadStore((s) => s.selectedPlaneId)
  const id = useCadStore((s) => (s.selectedIds.length === 1 ? s.selectedIds[0] : null))
  const node = useCadStore((s) => (id ? s.doc.nodes[id] : null))
  const isChild = useCadStore((s) => (id ? !s.doc.rootIds.includes(id) : false))
  const selectedCount = useCadStore((s) => s.selectedIds.length)
  const doc = useCadStore((s) => s.doc)

  const setNodeTransform = useCadStore((s) => s.setNodeTransform)
  const setNodeName = useCadStore((s) => s.setNodeName)
  const setNodeColor = useCadStore((s) => s.setNodeColor)
  const setRole = useCadStore((s) => s.setRole)
  const ungroup = useCadStore((s) => s.ungroup)

  if (planeId) return <PlaneEditor width={width} planeId={planeId} />

  if (!node || !id) {
    return (
      <PropertyShell width={width}>
        <p className="text-sm text-fg-faint">
          {selectedCount > 1
            ? `${selectedCount} objects selected.`
            : 'Select a single object to edit it.'}
        </p>
      </PropertyShell>
    )
  }

  const t = node.transform

  // Scaling a leaf primitive bakes into its params, so its own scale is normally
  // identity — hide the redundant Scale field unless a residual scale remains
  // (non-uniform sphere/cylinder, or a legacy doc not yet normalized).
  const showScale = node.kind !== 'primitive' || t.scale.some(scaled)

  // "Effective size": the primitive's printed dimensions once accumulated world
  // scale (its own residual + any inherited group scale) is applied. Only shown
  // when scale actually changes the size, so it doesn't duplicate the Size field.
  const ws = worldScale(doc, id)
  const localDims = node.kind === 'primitive' ? primitiveLocalDimensions(node.params) : null
  const effectiveDims =
    localDims && ws.some(scaled)
      ? ([localDims[0] * ws[0], localDims[1] * ws[1], localDims[2] * ws[2]] as const)
      : null

  return (
    <PropertyShell width={width}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={node.color}
            onChange={(e) => setNodeColor(id, e.target.value)}
            className="h-7 w-7 shrink-0 cursor-pointer rounded border border-line-strong bg-transparent"
            title="Color"
          />
          <input
            value={node.name}
            onChange={(e) => setNodeName(id, e.target.value)}
            className="w-full rounded bg-elevated px-2 py-1 text-sm text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
          />
        </div>

        {isChild && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-faint">Role in group</span>
            <div className="flex overflow-hidden rounded border border-line-strong">
              {(['solid', 'hole'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRole(id, role)}
                  className={
                    'px-2 py-0.5 text-xs capitalize ' +
                    (node.role === role
                      ? 'bg-accent text-on-accent'
                      : 'text-fg-muted hover:bg-elevated')
                  }
                >
                  {role}
                </button>
              ))}
            </div>
          </div>
        )}

        <Vec3Field
          label="Position (mm)"
          value={t.position}
          step={1}
          live
          onCommit={(position) => setNodeTransform(id, { ...t, position })}
        />
        <Vec3Field
          label="Rotation (°)"
          value={t.rotationDeg}
          step={5}
          live
          onCommit={(rotationDeg) => setNodeTransform(id, { ...t, rotationDeg })}
        />
        {showScale && (
          <Vec3Field
            label="Scale"
            value={t.scale}
            step={0.1}
            min={0.01}
            live
            onCommit={(scale) => setNodeTransform(id, { ...t, scale })}
          />
        )}

        {effectiveDims && (
          <div className="flex items-center justify-between text-xs text-fg-faint">
            <span>Effective size</span>
            <span className="text-fg-muted">
              {fmtMm(effectiveDims[0])} × {fmtMm(effectiveDims[1])} × {fmtMm(effectiveDims[2])} mm
            </span>
          </div>
        )}

        {node.kind === 'primitive' && (
          <div className="border-t border-line pt-3">
            <PrimitiveParamsEditor node={node} />
          </div>
        )}

        {(node.kind === 'pattern' || node.kind === 'shell') && (
          <div className="space-y-2 border-t border-line pt-3">
            {node.kind === 'pattern' ? <PatternEditor node={node} /> : <ShellEditor node={node} />}
            <MiniButton onClick={() => ungroup(id)}>
              Remove {node.kind === 'pattern' ? 'pattern' : 'shell'}
            </MiniButton>
          </div>
        )}
      </div>
    </PropertyShell>
  )
}
