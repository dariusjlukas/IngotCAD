/** Edits the selected node: name, color, transform, shape params, and role. */
import type { ReactNode } from 'react'
import { useCadStore } from '../document/store'
import { useSketchStore } from '../sketch/sketchStore'
import type { PrimitiveNode, PrimitiveParams } from '../document/types'
import { NumberField, Vec3Field } from './NumberField'

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
              onCommit={(height) => update({ ...params, height })}
            />
          </Field>
          <Field label="Radius ⌀ bottom">
            <NumberField
              value={params.radiusBottom}
              min={0}
              onCommit={(radiusBottom) => update({ ...params, radiusBottom })}
            />
          </Field>
          <Field label="Radius ⌀ top">
            <NumberField
              value={params.radiusTop}
              min={0}
              onCommit={(radiusTop) => update({ ...params, radiusTop })}
            />
          </Field>
          <Field label="Sides">
            <NumberField
              value={params.segments}
              min={3}
              step={1}
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
              onCommit={(radius) => update({ ...params, radius })}
            />
          </Field>
          <Field label="Segments">
            <NumberField
              value={params.segments}
              min={4}
              step={1}
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
              onCommit={(degrees) => update({ ...params, degrees: Math.min(360, degrees) })}
            />
          </Field>
          <Field label="Segments">
            <NumberField
              value={params.segments}
              min={3}
              step={1}
              onCommit={(segments) => update({ ...params, segments: Math.round(segments) })}
            />
          </Field>
          {params.sketch && <EditSketchButton nodeId={node.id} />}
        </div>
      )
    case 'mesh':
      return <p className="text-xs text-fg-faint">Imported mesh — no editable parameters.</p>
  }
}

export function PropertyEditor({ width }: { width: number }) {
  const id = useCadStore((s) => (s.selectedIds.length === 1 ? s.selectedIds[0] : null))
  const node = useCadStore((s) => (id ? s.doc.nodes[id] : null))
  const isChild = useCadStore((s) => (id ? !s.doc.rootIds.includes(id) : false))
  const selectedCount = useCadStore((s) => s.selectedIds.length)

  const transformNode = useCadStore((s) => s.transformNode)
  const setNodeName = useCadStore((s) => s.setNodeName)
  const setNodeColor = useCadStore((s) => s.setNodeColor)
  const setRole = useCadStore((s) => s.setRole)

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
          onCommit={(position) => transformNode(id, { ...t, position })}
        />
        <Vec3Field
          label="Rotation (°)"
          value={t.rotationDeg}
          step={5}
          onCommit={(rotationDeg) => transformNode(id, { ...t, rotationDeg })}
        />
        <Vec3Field
          label="Scale"
          value={t.scale}
          step={0.1}
          min={0.01}
          onCommit={(scale) => transformNode(id, { ...t, scale })}
        />

        {node.kind === 'primitive' && (
          <div className="border-t border-line pt-3">
            <PrimitiveParamsEditor node={node} />
          </div>
        )}
      </div>
    </PropertyShell>
  )
}
