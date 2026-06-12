/**
 * Non-fatal evaluation warnings, keyed by the root node whose evaluation
 * produced them (a warning's own `nodeId` may be a descendant of that root —
 * e.g. an edge-treatment node deep in a subtree). Derived display state; the
 * outliner and property editor badge nodes that appear here.
 */
import { create } from 'zustand'
import type { NodeId } from '../document/types'
import type { EvalWarning } from './protocol'

interface EvalWarningsState {
  /** Warnings from the latest evaluation of each root. */
  byRoot: Record<NodeId, EvalWarning[]>
}

export const useEvalWarningsStore = create<EvalWarningsState>(() => ({
  byRoot: {},
}))

/** Replace the warnings produced by evaluating `rootId` (empty list clears). */
export function setEvalWarnings(rootId: NodeId, warnings: EvalWarning[]): void {
  const { byRoot } = useEvalWarningsStore.getState()
  if (warnings.length === 0) {
    if (!(rootId in byRoot)) return
    const next = { ...byRoot }
    delete next[rootId]
    useEvalWarningsStore.setState({ byRoot: next })
    return
  }
  useEvalWarningsStore.setState({ byRoot: { ...byRoot, [rootId]: warnings } })
}

/** All current warnings that refer to the given node. */
export function warningsForNode(byRoot: Record<NodeId, EvalWarning[]>, id: NodeId): EvalWarning[] {
  const out: EvalWarning[] = []
  for (const list of Object.values(byRoot)) {
    for (const w of list) if (w.nodeId === id) out.push(w)
  }
  return out
}
