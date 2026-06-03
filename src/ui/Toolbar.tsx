/** The main command bar: create, transform-mode, combine, edit, and file I/O. */
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useCadStore } from '../document/store'
import { selectCanRedo, selectCanUndo, selectSingleSelected } from '../document/selectors'
import { useViewportStore } from '../viewport/viewportStore'
import type { GizmoMode } from '../viewport/viewportStore'
import { useSketchStore } from '../sketch/sketchStore'
import { exportStl } from '../io/stlExport'
import { export3mf } from '../io/threemfExport'
import { importStlFile } from '../io/stlImport'
import { openProjectFile, saveProject } from '../io/projectFile'

function Btn({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  active?: boolean
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
        (active ? 'bg-blue-600 text-white ' : 'text-neutral-200 hover:bg-neutral-700 ') +
        'disabled:cursor-not-allowed disabled:opacity-35'
      }
    >
      {children}
    </button>
  )
}

/** A cluster of buttons that wraps as a unit (so groups never split awkwardly). */
function Group({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex shrink-0 items-center gap-1 ${className}`}>{children}</div>
}

function Divider() {
  return <div className="h-5 w-px shrink-0 bg-neutral-700" />
}

export function Toolbar() {
  const selectedIds = useCadStore((s) => s.selectedIds)
  const canUndo = useCadStore(selectCanUndo)
  const canRedo = useCadStore(selectCanRedo)
  const selected = useCadStore(selectSingleSelected)

  const addPrimitive = useCadStore((s) => s.addPrimitive)
  const applyBoolean = useCadStore((s) => s.applyBoolean)
  const group = useCadStore((s) => s.group)
  const ungroup = useCadStore((s) => s.ungroup)
  const deleteNodes = useCadStore((s) => s.deleteNodes)
  const undo = useCadStore((s) => s.undo)
  const redo = useCadStore((s) => s.redo)
  const newDocument = useCadStore((s) => s.newDocument)

  const gizmoMode = useViewportStore((s) => s.gizmoMode)
  const setGizmoMode = useViewportStore((s) => s.setGizmoMode)
  const openSketch = useSketchStore((s) => s.open)

  const stlInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)

  const multi = selectedIds.length >= 2
  const hasSelection = selectedIds.length > 0
  const canUngroup = selected != null && selected.kind !== 'primitive'

  const modeBtn = (mode: GizmoMode, label: string, key: string) => (
    <Btn onClick={() => setGizmoMode(mode)} active={gizmoMode === mode} title={`${label} (${key})`}>
      {label}
    </Btn>
  )

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 bg-neutral-900 px-2 py-1.5">
      <span className="mr-1 shrink-0 select-none text-sm font-semibold text-neutral-100">
        Hobby&nbsp;CAD
      </span>

      <Group>
        <Btn onClick={() => addPrimitive('box')} title="Add a box">＋ Box</Btn>
        <Btn onClick={() => addPrimitive('cylinder')} title="Add a cylinder">＋ Cylinder</Btn>
        <Btn onClick={() => addPrimitive('sphere')} title="Add a sphere">＋ Sphere</Btn>
        <Btn onClick={() => openSketch()} title="Sketch a 2D profile and extrude it">✎ Sketch</Btn>
      </Group>

      <Divider />

      <Group>
        {modeBtn('translate', 'Move', 'W')}
        {modeBtn('rotate', 'Rotate', 'E')}
        {modeBtn('scale', 'Scale', 'R')}
      </Group>

      <Divider />

      <Group>
        <Btn onClick={() => applyBoolean(selectedIds, 'union')} disabled={!multi} title="Union (combine)">
          Union
        </Btn>
        <Btn
          onClick={() => applyBoolean(selectedIds, 'subtract')}
          disabled={!multi}
          title="Subtract later objects from the first selected"
        >
          Subtract
        </Btn>
        <Btn onClick={() => applyBoolean(selectedIds, 'intersect')} disabled={!multi} title="Intersect">
          Intersect
        </Btn>
        <Btn onClick={() => group(selectedIds)} disabled={!multi} title="Group">
          Group
        </Btn>
        <Btn onClick={() => selected && ungroup(selected.id)} disabled={!canUngroup} title="Ungroup">
          Ungroup
        </Btn>
      </Group>

      <Divider />

      <Group>
        <Btn onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">Undo</Btn>
        <Btn onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">Redo</Btn>
        <Btn onClick={() => deleteNodes(selectedIds)} disabled={!hasSelection} title="Delete (Del)">
          Delete
        </Btn>
      </Group>

      <Group className="ml-auto">
        <Btn onClick={() => newDocument()} title="New project">New</Btn>
        <Btn onClick={() => projectInputRef.current?.click()} title="Open a project (.json)">Open</Btn>
        <Btn onClick={() => saveProject()} title="Save project (.json)">Save</Btn>
        <Divider />
        <Btn onClick={() => stlInputRef.current?.click()} title="Import an STL mesh">Import STL</Btn>
        <Btn onClick={() => exportStl(useCadStore.getState().doc)} title="Export watertight STL">
          Export STL
        </Btn>
        <Btn onClick={() => export3mf(useCadStore.getState().doc)} title="Export 3MF (print-ready)">
          Export 3MF
        </Btn>
      </Group>

      <input
        ref={stlInputRef}
        type="file"
        accept=".stl"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importStlFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,.hcad,.hcad.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void openProjectFile(file).catch((err) => alert(String(err)))
          e.target.value = ''
        }}
      />
    </div>
  )
}
