/** The modeling tool bar: create, transform-mode, combine, and quick edits. */
import type { MouseEvent, ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCube,
  faDatabase,
  faCircle,
  faPencil,
  faBorderAll,
  faArrowPointer,
  faFont,
  faRuler,
  faScissors,
} from '@fortawesome/free-solid-svg-icons'
import { DEFAULT_PATTERN_SPEC, DEFAULT_SHELL_THICKNESS, useCadStore } from '../document/store'
import { selectCanRedo, selectCanUndo, selectSingleSelected } from '../document/selectors'
import { useViewportStore } from '../viewport/viewportStore'
import type { ToolMode } from '../viewport/viewportStore'
import { usePlaneBuilderStore } from '../viewport/planeBuilderStore'
import { toggleMeasure, useMeasureStore } from '../viewport/measureStore'
import { useSectionStore } from '../viewport/sectionStore'
import { useEdgeTreatmentStore } from '../viewport/edgeTreatmentStore'
import { useSketchStore } from '../sketch/sketchStore'
import { textToContours } from '../text/font'
import { openContextMenu } from './contextMenuStore'
import { toast } from './toastStore'

function Btn({
  onClick,
  disabled,
  active,
  title,
  children,
}: {
  onClick: (e: MouseEvent) => void
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
        (active ? 'bg-accent text-on-accent ' : 'text-fg hover:bg-elevated ') +
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
  return <div className="h-5 w-px shrink-0 bg-line-strong" />
}

export function Toolbar() {
  const selectedIds = useCadStore((s) => s.selectedIds)
  const canUndo = useCadStore(selectCanUndo)
  const canRedo = useCadStore(selectCanRedo)
  const selected = useCadStore(selectSingleSelected)

  const addPrimitive = useCadStore((s) => s.addPrimitive)
  const addText = useCadStore((s) => s.addText)
  const addPlane = useCadStore((s) => s.addPlane)
  const applyBoolean = useCadStore((s) => s.applyBoolean)
  const group = useCadStore((s) => s.group)
  const ungroup = useCadStore((s) => s.ungroup)
  const patternNodes = useCadStore((s) => s.patternNodes)
  const shellNodes = useCadStore((s) => s.shellNodes)
  const edgeTreatmentNodes = useCadStore((s) => s.edgeTreatmentNodes)
  const deleteNodes = useCadStore((s) => s.deleteNodes)
  const undo = useCadStore((s) => s.undo)
  const redo = useCadStore((s) => s.redo)

  const tool = useViewportStore((s) => s.tool)
  const setTool = useViewportStore((s) => s.setTool)
  const openSketch = useSketchStore((s) => s.open)
  const startPlaneTool = usePlaneBuilderStore((s) => s.start)
  const measureActive = useMeasureStore((s) => s.active)
  const sectionEnabled = useSectionStore((s) => s.enabled)
  const setSectionEnabled = useSectionStore((s) => s.setEnabled)

  // Picking modes are mutually exclusive: starting a plane pick or a sketch
  // ends an active measure session.
  const startPlanePick = (tool: Parameters<typeof startPlaneTool>[0]) => {
    useMeasureStore.getState().cancel()
    startPlaneTool(tool)
  }

  const openPlaneMenu = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    openContextMenu(r.left, r.bottom + 4, [
      {
        label: 'Offset plane (from XY)',
        onSelect: () => addPlane({ kind: 'offset', base: 'xy', distance: 0 }),
      },
      { label: 'Parallel to a face…', onSelect: () => startPlanePick('face') },
      { label: 'Through 3 points…', onSelect: () => startPlanePick('threePoints') },
      { label: 'At an angle about an edge…', onSelect: () => startPlanePick('edgeAngle') },
    ])
  }

  const handleAddText = async () => {
    try {
      const profile = await textToContours('Text', 10)
      if (profile.length === 0) {
        toast.error('Nothing to render for that text.')
        return
      }
      addText('Text', 10, 4, profile)
    } catch {
      toast.error('Could not load the text font.')
    }
  }

  // Wrap the selection (or reuse an already-selected chamfer/fillet node) and
  // enter edge-picking mode.
  const startEdgeTreatment = (kind: 'chamfer' | 'fillet') => {
    useMeasureStore.getState().cancel()
    const s = useCadStore.getState()
    const single = s.selectedIds.length === 1 ? s.doc.nodes[s.selectedIds[0]] : null
    const nodeId = single?.kind === 'edgeTreatment' ? single.id : edgeTreatmentNodes(s.selectedIds)
    if (nodeId) useEdgeTreatmentStore.getState().start(nodeId, kind, 2)
  }

  const openEdgeMenu = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    openContextMenu(r.left, r.bottom + 4, [
      { label: 'Chamfer edges…', onSelect: () => startEdgeTreatment('chamfer') },
      { label: 'Fillet edges…', onSelect: () => startEdgeTreatment('fillet') },
    ])
  }

  const openPatternMenu = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    openContextMenu(r.left, r.bottom + 4, [
      {
        label: 'Linear pattern',
        onSelect: () => patternNodes(selectedIds, DEFAULT_PATTERN_SPEC.linear),
      },
      {
        label: 'Circular pattern',
        onSelect: () => patternNodes(selectedIds, DEFAULT_PATTERN_SPEC.circular),
      },
      { label: 'Mirror', onSelect: () => patternNodes(selectedIds, DEFAULT_PATTERN_SPEC.mirror) },
    ])
  }

  const multi = selectedIds.length >= 2
  const hasSelection = selectedIds.length > 0
  const canUngroup = selected != null && selected.kind !== 'primitive'

  const modeBtn = (mode: ToolMode, label: string, key: string) => (
    <Btn onClick={() => setTool(mode)} active={tool === mode} title={`${label} (${key})`}>
      {label}
    </Btn>
  )

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line bg-panel px-2 py-1.5">
      <Group>
        <Btn onClick={() => addPrimitive('box')} title="Add a box">
          <FontAwesomeIcon icon={faCube} fixedWidth /> Box
        </Btn>
        <Btn onClick={() => addPrimitive('cylinder')} title="Add a cylinder">
          <FontAwesomeIcon icon={faDatabase} fixedWidth /> Cylinder
        </Btn>
        <Btn onClick={() => addPrimitive('sphere')} title="Add a sphere">
          <FontAwesomeIcon icon={faCircle} fixedWidth /> Sphere
        </Btn>
        <Btn
          onClick={() => {
            useMeasureStore.getState().cancel()
            openSketch()
          }}
          title="Sketch a 2D profile and extrude it"
        >
          <FontAwesomeIcon icon={faPencil} fixedWidth /> Sketch
        </Btn>
        <Btn onClick={() => void handleAddText()} title="Add extruded 3D text">
          <FontAwesomeIcon icon={faFont} fixedWidth /> Text
        </Btn>
        <Btn onClick={openPlaneMenu} title="Add a construction plane">
          <FontAwesomeIcon icon={faBorderAll} fixedWidth /> Plane ▾
        </Btn>
      </Group>

      <Divider />

      <Group>
        <Btn onClick={() => setTool('select')} active={tool === 'select'} title="Select (Q)">
          <FontAwesomeIcon icon={faArrowPointer} fixedWidth /> Select
        </Btn>
        {modeBtn('translate', 'Move', 'W')}
        {modeBtn('rotate', 'Rotate', 'E')}
        {modeBtn('scale', 'Scale', 'R')}
        <Btn onClick={toggleMeasure} active={measureActive} title="Measure (M)">
          <FontAwesomeIcon icon={faRuler} fixedWidth /> Measure
        </Btn>
        <Btn
          onClick={() => setSectionEnabled(!sectionEnabled)}
          active={sectionEnabled}
          title="Section view: clip the model with a plane"
        >
          <FontAwesomeIcon icon={faScissors} fixedWidth /> Section
        </Btn>
      </Group>

      <Divider />

      <Group>
        <Btn
          onClick={() => applyBoolean(selectedIds, 'union')}
          disabled={!multi}
          title="Union (combine)"
        >
          Union
        </Btn>
        <Btn
          onClick={() => applyBoolean(selectedIds, 'subtract')}
          disabled={!multi}
          title="Subtract later objects from the first selected"
        >
          Subtract
        </Btn>
        <Btn
          onClick={() => applyBoolean(selectedIds, 'intersect')}
          disabled={!multi}
          title="Intersect"
        >
          Intersect
        </Btn>
        <Btn onClick={() => group(selectedIds)} disabled={!multi} title="Group">
          Group
        </Btn>
        <Btn
          onClick={() => selected && ungroup(selected.id)}
          disabled={!canUngroup}
          title="Ungroup"
        >
          Ungroup
        </Btn>
      </Group>

      <Divider />

      <Group>
        <Btn
          onClick={openPatternMenu}
          disabled={!hasSelection}
          title="Linear / circular / mirror pattern"
        >
          Pattern ▾
        </Btn>
        <Btn
          onClick={() => shellNodes(selectedIds, DEFAULT_SHELL_THICKNESS, false)}
          disabled={!hasSelection}
          title="Hollow the object to a wall (shell)"
        >
          Shell
        </Btn>
        <Btn
          onClick={openEdgeMenu}
          disabled={!hasSelection}
          title="Chamfer or fillet the object's edges"
        >
          Chamfer ▾
        </Btn>
      </Group>

      <Divider />

      <Group>
        <Btn onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </Btn>
        <Btn onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </Btn>
        <Btn onClick={() => deleteNodes(selectedIds)} disabled={!hasSelection} title="Delete (Del)">
          Delete
        </Btn>
      </Group>
    </div>
  )
}
