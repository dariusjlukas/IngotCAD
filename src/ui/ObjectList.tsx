/** The outliner: a tree of the document's nodes with selection + visibility. */
import { useCadStore } from '../document/store'
import type { CadNode, NodeId } from '../document/types'
import { hasChildren } from '../document/types'

const KIND_GLYPH: Record<CadNode['kind'], string> = {
  primitive: '◆',
  group: '▦',
  boolean: '∮',
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
          (selected ? 'bg-blue-600/30 text-white' : 'text-neutral-300 hover:bg-neutral-800')
        }
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <span className="w-3 shrink-0 text-neutral-500" style={{ color: node.color }}>
          {KIND_GLYPH[node.kind]}
        </span>
        <span className="flex-1 truncate">{node.name}</span>
        {node.role === 'hole' && (
          <span className="rounded bg-rose-500/20 px-1 text-[10px] uppercase text-rose-300">hole</span>
        )}
        <button
          type="button"
          title={node.visible ? 'Hide' : 'Show'}
          onClick={(e) => {
            e.stopPropagation()
            setNodeVisible(id, !node.visible)
          }}
          className="shrink-0 px-0.5 text-neutral-500 hover:text-neutral-200"
        >
          {node.visible ? '👁' : '⊘'}
        </button>
      </div>
      {hasChildren(node) &&
        node.childIds.map((cid) => <ObjectRow key={cid} id={cid} depth={depth + 1} />)}
    </>
  )
}

export function ObjectList() {
  const rootIds = useCadStore((s) => s.doc.rootIds)

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Objects
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {rootIds.length === 0 ? (
          <p className="px-2 py-3 text-sm text-neutral-500">
            Nothing yet. Add a box, cylinder, or sphere from the toolbar.
          </p>
        ) : (
          rootIds.map((id) => <ObjectRow key={id} id={id} depth={0} />)
        )}
      </div>
    </aside>
  )
}
