/** Reusable store selectors (pure; pass to `useCadStore(selector)`). */
import type { CadState } from './store'
import type { CadNode } from './types'

export const selectCanUndo = (s: CadState): boolean => s.past.length > 0
export const selectCanRedo = (s: CadState): boolean => s.future.length > 0

export const selectSelectedNodes = (s: CadState): CadNode[] =>
  s.selectedIds.map((id) => s.doc.nodes[id]).filter((n): n is CadNode => Boolean(n))

/** The single selected node, or null when the selection is empty or multiple. */
export const selectSingleSelected = (s: CadState): CadNode | null =>
  s.selectedIds.length === 1 ? (s.doc.nodes[s.selectedIds[0]] ?? null) : null
