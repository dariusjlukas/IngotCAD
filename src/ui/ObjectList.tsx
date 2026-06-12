/**
 * The outliner: a tree of the document's nodes with selection, visibility,
 * inline rename, expand/collapse, range-select, and drag-to-reorder/reparent.
 *
 * Rows are rendered from a flattened (depth-tagged) list so range-select and
 * drag math have a stable visual order; the tree shape comes from indentation.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCube,
  faObjectGroup,
  faShapes,
  faEye,
  faEyeSlash,
  faChevronRight,
  faChevronDown,
  faBorderAll,
  faClone,
  faBoxOpen,
  faBezierCurve,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { useCadStore } from '../document/store'
import type { DropPosition } from '../document/store'
import type { CadDocument, CadNode, NodeId } from '../document/types'
import { hasChildren } from '../document/types'
import { useEvalWarningsStore, warningsForNode } from '../engine/evalWarningsStore'
import { useFaceRefStatusStore } from '../document/faceRefStatusStore'
import { resolveVariables } from '../document/expressions'
import { toast } from './toastStore'
import { openContextMenu, type ContextMenuEntry } from './contextMenuStore'
import { objectMenuEntries } from './objectMenu'

/** ⚠ on a face-derived plane / face-attached sketch whose source face drifted. */
function StaleFaceBadge({ dependentKey }: { dependentKey: string }) {
  const info = useFaceRefStatusStore((s) => s.stale[dependentKey])
  if (!info) return null
  return (
    <span
      className="text-danger"
      title={info.status === 'moved' ? 'Source face moved' : 'Source face missing'}
    >
      <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
    </span>
  )
}

/** ⚠ on nodes whose last evaluation reported problems (e.g. a lost edge pick),
 *  or whose face-attached sketch lost its source face. */
function NodeWarningBadge({ id }: { id: NodeId }) {
  const byRoot = useEvalWarningsStore((s) => s.byRoot)
  const staleFace = useFaceRefStatusStore((s) => s.stale[id])
  const warnings = warningsForNode(byRoot, id)
  if (warnings.length === 0 && !staleFace) return null
  const titles = [
    ...warnings.map((w) => w.message),
    ...(staleFace
      ? [staleFace.status === 'moved' ? 'Source face moved' : 'Source face missing']
      : []),
  ]
  return (
    <span className="text-danger" title={titles.join('\n')}>
      <FontAwesomeIcon icon={faTriangleExclamation} className="h-3 w-3" />
    </span>
  )
}

const KIND_ICON: Record<CadNode['kind'], IconDefinition> = {
  primitive: faCube,
  group: faObjectGroup,
  boolean: faShapes,
  pattern: faClone,
  shell: faBoxOpen,
  edgeTreatment: faBezierCurve,
}

interface FlatRow {
  id: NodeId
  depth: number
}

function flatten(doc: CadDocument, collapsed: Set<NodeId>): FlatRow[] {
  const out: FlatRow[] = []
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id]
    if (!n) return
    out.push({ id, depth })
    if (hasChildren(n) && !collapsed.has(id)) n.childIds.forEach((c) => walk(c, depth + 1))
  }
  doc.rootIds.forEach((id) => walk(id, 0))
  return out
}

/** Does the subtree rooted at `rootId` contain `id`? (drop-into-self guard) */
function subtreeHas(doc: CadDocument, rootId: NodeId, id: NodeId): boolean {
  if (rootId === id) return true
  const n = doc.nodes[rootId]
  return hasChildren(n) ? n.childIds.some((c) => subtreeHas(doc, c, id)) : false
}

function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      aria-label="Rename"
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(e.currentTarget.value)
        else if (e.key === 'Escape') onCancel()
      }}
      className="w-full rounded bg-elevated px-1 py-0.5 text-sm text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
    />
  )
}

interface RowProps {
  node: CadNode
  depth: number
  selected: boolean
  isContainer: boolean
  collapsed: boolean
  renaming: boolean
  drop: DropPosition | null
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onToggleCollapse: () => void
  onToggleVisible: () => void
  onStartRename: () => void
  onCommitRename: (value: string) => void
  onCancelRename: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

function Row({
  node,
  depth,
  selected,
  isContainer,
  collapsed,
  renaming,
  drop,
  onClick,
  onContextMenu,
  onToggleCollapse,
  onToggleVisible,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: RowProps) {
  return (
    <div
      draggable={!renaming}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={
        'relative flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm ' +
        (selected ? 'bg-selection text-fg-strong' : 'text-fg-muted hover:bg-elevated') +
        (drop === 'inside' ? ' ring-1 ring-inset ring-accent' : '')
      }
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {drop === 'before' && (
        <div className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
      )}
      {drop === 'after' && (
        <div className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
      )}

      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          if (isContainer) onToggleCollapse()
        }}
        className={
          'flex w-3 shrink-0 justify-center text-fg-faint ' +
          (isContainer ? 'hover:text-fg' : 'invisible')
        }
      >
        <FontAwesomeIcon
          icon={collapsed ? faChevronRight : faChevronDown}
          className="h-2.5 w-2.5"
        />
      </button>

      <span className="flex w-4 shrink-0 justify-center" style={{ color: node.color }}>
        <FontAwesomeIcon icon={KIND_ICON[node.kind]} fixedWidth />
      </span>

      {renaming ? (
        <div className="flex-1">
          <RenameInput initial={node.name} onCommit={onCommitRename} onCancel={onCancelRename} />
        </div>
      ) : (
        <span
          className="flex-1 truncate"
          onDoubleClick={(e) => {
            e.stopPropagation()
            onStartRename()
          }}
        >
          {node.name}
        </span>
      )}

      {node.role === 'hole' && (
        <span className="rounded bg-danger-surface px-1 text-[10px] uppercase text-danger">
          hole
        </span>
      )}
      <NodeWarningBadge id={node.id} />
      <button
        type="button"
        tabIndex={-1}
        title={node.visible ? 'Hide' : 'Show'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleVisible()
        }}
        className="shrink-0 px-0.5 text-fg-faint hover:text-fg"
      >
        <FontAwesomeIcon icon={node.visible ? faEye : faEyeSlash} fixedWidth />
      </button>
    </div>
  )
}

/**
 * Document variables ("wall = 2.4"), below the tree. Expressions may reference
 * other variables; any dimension field accepts them (e.g. type "wall * 2" into
 * a box size). Editing a value here rewrites every bound field in one undo step.
 */
function VariablesSection() {
  const variables = useCadStore((s) => s.doc.variables)
  const setVariable = useCadStore((s) => s.setVariable)
  const removeVariable = useCadStore((s) => s.removeVariable)
  const [newName, setNewName] = useState('')
  const [newExpr, setNewExpr] = useState('')

  const { values, errors } = resolveVariables(variables)

  const add = () => {
    const name = newName.trim()
    if (!name) return
    if (variables.some((v) => v.name === name)) {
      toast.error(`"${name}" already exists.`)
      return
    }
    if (!setVariable(name, newExpr.trim() || '0')) {
      toast.error('Variable names must start with a letter (and not shadow pi/sin/…).')
      return
    }
    setNewName('')
    setNewExpr('')
  }

  return (
    <div className="mt-1 border-t border-line pt-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
        Variables
      </div>
      {variables.map((v) => {
        const error = errors[v.name]
        return (
          <div key={v.name} className="group flex items-center gap-1 py-0.5 pr-1.5 pl-2 text-sm">
            <span className="w-20 shrink-0 truncate font-mono text-xs text-fg" title={v.name}>
              {v.name}
            </span>
            <VariableExprInput
              expr={v.expr}
              onCommit={(expr) => setVariable(v.name, expr)}
              error={error}
            />
            <span
              className={
                'w-12 shrink-0 text-right text-xs ' + (error ? 'text-danger' : 'text-fg-faint')
              }
              title={error}
            >
              {error ? '⚠' : Math.round((values[v.name] ?? 0) * 1000) / 1000}
            </span>
            <button
              type="button"
              onClick={() => removeVariable(v.name)}
              className="shrink-0 px-0.5 text-fg-faint opacity-0 group-hover:opacity-100 hover:text-danger"
              title="Delete variable (bound fields keep their current value)"
            >
              ×
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-1 py-0.5 pr-1.5 pl-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="name"
          className="w-20 shrink-0 rounded bg-elevated px-1 py-0.5 font-mono text-xs text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
        />
        <input
          value={newExpr}
          onChange={(e) => setNewExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add()
          }}
          placeholder="value or expression"
          className="min-w-0 flex-1 rounded bg-elevated px-1 py-0.5 font-mono text-xs text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
        />
        <button
          type="button"
          onClick={add}
          disabled={newName.trim() === ''}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-elevated disabled:opacity-30"
        >
          Add
        </button>
      </div>
    </div>
  )
}

/** Inline expression editor for one variable (commit on blur/Enter). */
function VariableExprInput({
  expr,
  onCommit,
  error,
}: {
  expr: string
  onCommit: (expr: string) => void
  error?: string
}) {
  const [text, setText] = useState(expr)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(expr)
  }, [expr])
  return (
    <input
      value={text}
      onFocus={() => {
        focused.current = true
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false
        const t = text.trim()
        if (t && t !== expr) onCommit(t)
        else setText(expr)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={
        'min-w-0 flex-1 rounded bg-elevated px-1 py-0.5 font-mono text-xs outline-none focus:ring-1 focus:ring-accent-ring ' +
        (error ? 'text-danger' : 'text-fg-strong')
      }
    />
  )
}

/** A flat list of the document's construction planes (datums), below the tree. */
function PlaneSection() {
  const planeOrder = useCadStore((s) => s.doc.planeOrder)
  const planes = useCadStore((s) => s.doc.planes)
  const selectedPlaneId = useCadStore((s) => s.selectedPlaneId)
  const selectPlane = useCadStore((s) => s.selectPlane)
  const setPlaneVisible = useCadStore((s) => s.setPlaneVisible)
  const renamePlane = useCadStore((s) => s.renamePlane)
  const deletePlane = useCadStore((s) => s.deletePlane)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  if (planeOrder.length === 0) return null

  return (
    <div className="mt-1 border-t border-line pt-1">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
        Construction planes
      </div>
      {planeOrder.map((id) => {
        const p = planes[id]
        if (!p) return null
        const selected = selectedPlaneId === id
        return (
          <div
            key={id}
            onClick={() => selectPlane(id)}
            onContextMenu={(e) => {
              e.preventDefault()
              selectPlane(id)
              openContextMenu(e.clientX, e.clientY, [
                { label: 'Rename', onSelect: () => setRenamingId(id) },
                { label: 'Delete', onSelect: () => deletePlane(id) },
              ])
            }}
            className={
              'flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1.5 pl-2 text-sm ' +
              (selected ? 'bg-selection text-fg-strong' : 'text-fg-muted hover:bg-elevated')
            }
          >
            <span className="flex w-4 shrink-0 justify-center" style={{ color: '#ab9df2' }}>
              <FontAwesomeIcon icon={faBorderAll} fixedWidth />
            </span>
            {renamingId === id ? (
              <div className="flex-1">
                <RenameInput
                  initial={p.name}
                  onCommit={(v) => {
                    const t = v.trim()
                    if (t && t !== p.name) renamePlane(id, t)
                    setRenamingId(null)
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              </div>
            ) : (
              <span
                className="flex-1 truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setRenamingId(id)
                }}
              >
                {p.name}
              </span>
            )}
            <StaleFaceBadge dependentKey={id} />
            <button
              type="button"
              tabIndex={-1}
              title={p.visible ? 'Hide' : 'Show'}
              onClick={(e) => {
                e.stopPropagation()
                setPlaneVisible(id, !p.visible)
              }}
              className="shrink-0 px-0.5 text-fg-faint hover:text-fg"
            >
              <FontAwesomeIcon icon={p.visible ? faEye : faEyeSlash} fixedWidth />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function ObjectList({ width }: { width: number }) {
  const doc = useCadStore((s) => s.doc)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const select = useCadStore((s) => s.select)
  const toggleSelect = useCadStore((s) => s.toggleSelect)
  const setNodeVisible = useCadStore((s) => s.setNodeVisible)
  const setNodeName = useCadStore((s) => s.setNodeName)
  const moveNodes = useCadStore((s) => s.moveNodes)

  const [collapsed, setCollapsed] = useState<Set<NodeId>>(new Set())
  const [renamingId, setRenamingId] = useState<NodeId | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: NodeId; position: DropPosition } | null>(null)
  const anchorRef = useRef<NodeId | null>(null)
  const dragIdsRef = useRef<NodeId[] | null>(null)

  const rows = useMemo(() => flatten(doc, collapsed), [doc, collapsed])

  const toggleCollapse = (id: NodeId) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const onRowClick = (e: React.MouseEvent, id: NodeId) => {
    if (e.metaKey || e.ctrlKey) {
      toggleSelect(id)
      anchorRef.current = id
      return
    }
    if (e.shiftKey && anchorRef.current) {
      const i = rows.findIndex((r) => r.id === anchorRef.current)
      const j = rows.findIndex((r) => r.id === id)
      if (i >= 0 && j >= 0) {
        const [lo, hi] = i < j ? [i, j] : [j, i]
        select(rows.slice(lo, hi + 1).map((r) => r.id))
        return
      }
    }
    select([id])
    anchorRef.current = id
  }

  // Where would a drop on `id` land, or null if the drop is invalid here?
  const dropPositionFor = (e: React.DragEvent, id: NodeId): DropPosition | null => {
    const ids = dragIdsRef.current
    if (!ids || ids.includes(id)) return null
    if (ids.some((dragId) => subtreeHas(doc, dragId, id))) return null
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    const isGroup = doc.nodes[id]?.kind === 'group'
    if (isGroup && y > 0.25 && y < 0.75) return 'inside'
    return y < 0.5 ? 'before' : 'after'
  }

  const onDragStart = (id: NodeId) => {
    const sel = useCadStore.getState().selectedIds
    const ids = sel.includes(id) ? sel : [id]
    if (!sel.includes(id)) select([id])
    dragIdsRef.current = ids
  }

  const onDragOver = (e: React.DragEvent, id: NodeId) => {
    const position = dropPositionFor(e, id)
    if (!position) {
      if (dropTarget) setDropTarget(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget?.id !== id || dropTarget.position !== position) setDropTarget({ id, position })
  }

  const onDrop = (e: React.DragEvent, id: NodeId) => {
    e.preventDefault()
    const position = dropPositionFor(e, id)
    const ids = dragIdsRef.current
    if (position && ids) moveNodes(ids, id, position)
    dragIdsRef.current = null
    setDropTarget(null)
  }

  const onDragEnd = () => {
    dragIdsRef.current = null
    setDropTarget(null)
  }

  const onRowContextMenu = (e: React.MouseEvent, id: NodeId) => {
    e.preventDefault()
    const sel = useCadStore.getState().selectedIds
    const ids = sel.includes(id) ? sel : [id]
    if (!sel.includes(id)) {
      select([id])
      anchorRef.current = id
    }
    const entries: ContextMenuEntry[] = []
    if (ids.length === 1) entries.push({ label: 'Rename', onSelect: () => setRenamingId(id) })
    entries.push(...objectMenuEntries(ids))
    openContextMenu(e.clientX, e.clientY, entries)
  }

  return (
    <aside className="flex shrink-0 flex-col bg-panel" style={{ width }}>
      <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Objects
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rows.length === 0 && doc.planeOrder.length === 0 ? (
          <p className="px-2 py-3 text-sm text-fg-faint">
            Nothing yet. Add a box, cylinder, or sphere from the toolbar.
          </p>
        ) : (
          rows.map(({ id, depth }) => {
            const node = doc.nodes[id]
            if (!node) return null
            const container = hasChildren(node)
            return (
              <Row
                key={id}
                node={node}
                depth={depth}
                selected={selectedIds.includes(id)}
                isContainer={container}
                collapsed={collapsed.has(id)}
                renaming={renamingId === id}
                drop={dropTarget?.id === id ? dropTarget.position : null}
                onClick={(e) => onRowClick(e, id)}
                onContextMenu={(e) => onRowContextMenu(e, id)}
                onToggleCollapse={() => toggleCollapse(id)}
                onToggleVisible={() => setNodeVisible(id, !node.visible)}
                onStartRename={() => setRenamingId(id)}
                onCommitRename={(value) => {
                  const trimmed = value.trim()
                  if (trimmed && trimmed !== node.name) setNodeName(id, trimmed)
                  setRenamingId(null)
                }}
                onCancelRename={() => setRenamingId(null)}
                onDragStart={() => onDragStart(id)}
                onDragOver={(e) => onDragOver(e, id)}
                onDrop={(e) => onDrop(e, id)}
                onDragEnd={onDragEnd}
              />
            )
          })
        )}
        <PlaneSection />
        <VariablesSection />
      </div>
    </aside>
  )
}
