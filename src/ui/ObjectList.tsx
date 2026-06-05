/** The outliner: a tree of the document's nodes with selection + visibility. */
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCube,
  faObjectGroup,
  faShapes,
  faEye,
  faEyeSlash,
} from '@fortawesome/free-solid-svg-icons'
import { useCadStore } from '../document/store'
import type { CadNode, NodeId } from '../document/types'
import { hasChildren } from '../document/types'

const KIND_ICON: Record<CadNode['kind'], IconDefinition> = {
  primitive: faCube,
  group: faObjectGroup,
  boolean: faShapes,
}

function ObjectRow({ id, depth }: { id: NodeId; depth: number }) {
  const node = useCadStore((s) => s.doc.nodes[id])
  const selected = useCadStore((s) => s.selectedIds.includes(id))
  const select = useCadStore((s) => s.select)
  const toggleSelect = useCadStore((s) => s.toggleSelect)
  const setNodeVisible = useCadStore((s) => s.setNodeVisible)

  if (!node) return null

  return (
    <>
      <div
        onClick={(e) => (e.shiftKey ? toggleSelect(id) : select([id]))}
        className={
          'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm ' +
          (selected ? 'bg-selection text-fg-strong' : 'text-fg-muted hover:bg-elevated')
        }
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span
          className="flex w-4 shrink-0 justify-center text-fg-faint"
          style={{ color: node.color }}
        >
          <FontAwesomeIcon icon={KIND_ICON[node.kind]} fixedWidth />
        </span>
        <span className="flex-1 truncate">{node.name}</span>
        {node.role === 'hole' && (
          <span className="rounded bg-danger-surface px-1 text-[10px] uppercase text-danger">
            hole
          </span>
        )}
        <button
          type="button"
          title={node.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            setNodeVisible(id, !node.visible)
          }}
          className="shrink-0 px-0.5 text-fg-faint hover:text-fg"
        >
          <FontAwesomeIcon icon={node.visible ? faEye : faEyeSlash} fixedWidth />
        </button>
      </div>
      {hasChildren(node) &&
        node.childIds.map((cid) => <ObjectRow key={cid} id={cid} depth={depth + 1} />)}
    </>
  )
}

export function ObjectList({ width }: { width: number }) {
  const rootIds = useCadStore((s) => s.doc.rootIds)

  return (
    <aside className="flex shrink-0 flex-col bg-panel" style={{ width }}>
      <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Objects
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rootIds.length === 0 ? (
          <p className="px-2 py-3 text-sm text-fg-faint">
            Nothing yet. Add a box, cylinder, or sphere from the toolbar.
          </p>
        ) : (
          rootIds.map((id) => <ObjectRow key={id} id={id} depth={0} />)
        )}
      </div>
    </aside>
  )
}
