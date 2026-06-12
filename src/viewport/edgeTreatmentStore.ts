/**
 * Transient "pick edges to chamfer/fillet" mode (the planeBuilderStore
 * pattern): the toolbar wraps the selection in an edgeTreatment node and
 * starts this; NodeView highlights detected feature edges on that node and
 * feeds clicks into the document via addEdgeEntry. Not part of the saved
 * document or undo history.
 */
import { create } from 'zustand'
import type { NodeId } from '../document/types'

interface EdgeTreatmentPickState {
  /** The edgeTreatment node edges are being added to (null = inactive). */
  nodeId: NodeId | null
  kind: 'chamfer' | 'fillet'
  /** Size applied to newly picked edges (editable later per entry). */
  size: number
  start: (nodeId: NodeId, kind: 'chamfer' | 'fillet', size: number) => void
  cancel: () => void
}

export const useEdgeTreatmentStore = create<EdgeTreatmentPickState>((set) => ({
  nodeId: null,
  kind: 'chamfer',
  size: 2,
  start: (nodeId, kind, size) => set({ nodeId, kind, size }),
  cancel: () => set({ nodeId: null }),
}))
