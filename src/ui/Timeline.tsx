/**
 * A horizontal timeline of features in creation order. Click a feature to
 * select it (the property panel edits its params); double-click a sketch-based
 * feature to re-open its sketch. Editing any feature recomputes everything
 * downstream automatically (geometry derives from the node tree).
 */
import { useCadStore } from '../document/store'
import { useSketchStore } from '../sketch/sketchStore'
import type { CadNode, NodeId } from '../document/types'
import { objectMenuEntries } from './objectMenu'
import { openContextMenu, type ContextMenuEntry } from './contextMenuStore'

function isEditableSketch(n: CadNode): boolean {
  return (
    n.kind === 'primitive' &&
    (n.params.type === 'extrusion' || n.params.type === 'revolution') &&
    Boolean(n.params.sketch)
  )
}

export function Timeline() {
  const featureOrder = useCadStore((s) => s.doc.featureOrder)
  const nodes = useCadStore((s) => s.doc.nodes)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const select = useCadStore((s) => s.select)
  const editSketch = useSketchStore((s) => s.editSketch)

  const features = featureOrder.filter((id) => nodes[id])

  const onItemContextMenu = (e: React.MouseEvent, id: NodeId) => {
    e.preventDefault()
    const sel = useCadStore.getState().selectedIds
    const ids = sel.includes(id) ? sel : [id]
    if (!sel.includes(id)) select([id])
    const node = nodes[id]
    const entries: ContextMenuEntry[] = []
    if (ids.length === 1 && node && isEditableSketch(node)) {
      entries.push({ label: 'Edit sketch', onSelect: () => editSketch(id) })
      entries.push('separator')
    }
    entries.push(...objectMenuEntries(ids))
    openContextMenu(e.clientX, e.clientY, entries)
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-t border-line bg-panel px-2 py-1.5">
      <span className="mr-1 shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-faint">
        Timeline
      </span>
      {features.length === 0 && <span className="text-xs text-fg-faint">no features yet</span>}
      {features.map((id) => {
        const node = nodes[id]
        const selected = selectedIds.includes(id)
        const editable = isEditableSketch(node)
        return (
          <button
            key={id}
            type="button"
            onClick={() => select([id])}
            onDoubleClick={() => editable && editSketch(id)}
            onContextMenu={(e) => onItemContextMenu(e, id)}
            title={editable ? `${node.name} — double-click to edit sketch` : node.name}
            className={
              'flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 text-xs ' +
              (selected
                ? 'border-accent-ring bg-selection text-fg-strong'
                : 'border-line-strong text-fg-muted hover:bg-elevated')
            }
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: node.color }} />
            {node.name}
            {editable && <span className="text-fg-faint">✎</span>}
          </button>
        )
      })}
    </div>
  )
}
