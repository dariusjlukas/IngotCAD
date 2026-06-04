/** Edits the selected node: name, color, transform, shape params, and role. */
import type { ReactNode } from 'react'
import { useCadStore } from '../document/store'
import type { PrimitiveNode, PrimitiveParams } from '../document/types'
import { NumberField, Vec3Field } from './NumberField'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs text-neutral-500">{label}</span>
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
            <NumberField value={params.height} min={0.1} onCommit={(height) => update({ ...params, height })} />
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
            <NumberField value={params.radius} min={0.1} onCommit={(radius) => update({ ...params, radius })} />
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
            <NumberField value={params.height} min={0.1} onCommit={(height) => update({ ...params, height })} />
          </Field>
          <p className="text-xs text-neutral-500">
            Sketch: {params.profile.length} contour{params.profile.length === 1 ? '' : 's'},{' '}
            {params.profile.reduce((n, c) => n + c.length, 0)} points. Profile editing coming soon.
          </p>
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
          <p className="text-xs text-neutral-500">
            Revolved sketch — {params.profile.length} contour{params.profile.length === 1 ? '' : 's'}.
          </p>
        </div>
      )
    case 'mesh':
      return <p className="text-xs text-neutral-500">Imported mesh — no editable parameters.</p>
  }
}

export function PropertyEditor() {
  const id = useCadStore((s) => (s.selectedIds.length === 1 ? s.selectedIds[0] : null))
  const node = useCadStore((s) => (id ? s.doc.nodes[id] : null))
  const isChild = useCadStore((s) => (id ? !s.doc.rootIds.includes(id) : false))
  const selectedCount = useCadStore((s) => s.selectedIds.length)

  const transformNode = useCadStore((s) => s.transformNode)
  const setNodeName = useCadStore((s) => s.setNodeName)
  const setNodeColor = useCadStore((s) => s.setNodeColor)
  const setRole = useCadStore((s) => s.setRole)

  const Shell = ({ children }: { children: ReactNode }) => (
    <aside className="flex w-64 shrink-0 flex-col border-l border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Properties
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </aside>
  )

  if (!node || !id) {
    return (
      <Shell>
        <p className="text-sm text-neutral-500">
          {selectedCount > 1 ? `${selectedCount} objects selected.` : 'Select a single object to edit it.'}
        </p>
      </Shell>
    )
  }

  const t = node.transform

  return (
    <Shell>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={node.color}
            onChange={(e) => setNodeColor(id, e.target.value)}
            className="h-7 w-7 shrink-0 cursor-pointer rounded border border-neutral-700 bg-transparent"
            title="Color"
          />
          <input
            value={node.name}
            onChange={(e) => setNodeName(id, e.target.value)}
            className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {isChild && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-500">Role in group</span>
            <div className="flex overflow-hidden rounded border border-neutral-700">
              {(['solid', 'hole'] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRole(id, role)}
                  className={
                    'px-2 py-0.5 text-xs capitalize ' +
                    (node.role === role ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-neutral-800')
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
          <div className="border-t border-neutral-800 pt-3">
            <PrimitiveParamsEditor node={node} />
          </div>
        )}
      </div>
    </Shell>
  )
}
