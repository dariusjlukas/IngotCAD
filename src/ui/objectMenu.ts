/** Builds the context-menu entries for a right-click on object(s). Shared by the
 * outliner and the viewport so both offer the same operations. */
import { useCadStore } from '../document/store'
import type { NodeId } from '../document/types'
import type { ContextMenuEntry } from './contextMenuStore'

/** Operations for `ids` (assumed already selected). */
export function objectMenuEntries(ids: NodeId[]): ContextMenuEntry[] {
  const s = useCadStore.getState()
  const single = ids.length === 1 ? s.doc.nodes[ids[0]] : null
  const multi = ids.length >= 2

  const entries: ContextMenuEntry[] = [
    { label: 'Duplicate', onSelect: () => s.duplicateNodes(ids) },
    { label: 'Copy', onSelect: () => s.copyNodes(ids) },
  ]

  if (multi) {
    entries.push('separator')
    entries.push({ label: 'Group', onSelect: () => s.group(ids) })
    entries.push({ label: 'Union', onSelect: () => s.applyBoolean(ids, 'union') })
    entries.push({ label: 'Subtract', onSelect: () => s.applyBoolean(ids, 'subtract') })
    entries.push({ label: 'Intersect', onSelect: () => s.applyBoolean(ids, 'intersect') })
  } else if (single && single.kind !== 'primitive') {
    entries.push('separator')
    entries.push({ label: 'Ungroup', onSelect: () => s.ungroup(single.id) })
  }

  entries.push('separator')
  if (single) {
    entries.push({
      label: single.visible ? 'Hide' : 'Show',
      onSelect: () => s.setNodeVisible(single.id, !single.visible),
    })
  }
  entries.push({ label: 'Delete', onSelect: () => s.deleteNodes(ids), danger: true })

  return entries
}
