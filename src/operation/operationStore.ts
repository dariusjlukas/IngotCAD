/**
 * A pending extrude/revolve operation, awaiting confirmation. After a sketch is
 * committed we don't create the solid immediately — we hold the profile + plane
 * here and show a live preview in 3D. The user scrubs the value (height/angle)
 * and confirms (one undo step via the cad store) or cancels (nothing happens).
 */
import { create } from 'zustand'
import type { NodeId, SketchSource, Transform, Vec2 } from '../document/types'
import { useCadStore, type CombineTarget } from '../document/store'

/**
 * What confirming the operation produces: a standalone object (`new`), or the
 * result folded into the object the sketch was drawn on (`union` / `subtract`).
 * Only meaningful when the sketch has a `sourceNodeId`.
 */
export type CombineMode = 'new' | 'union' | 'subtract'

export interface PendingOp {
  mode: 'extrude' | 'revolve'
  /** Profile in plane-local mm (revolve: x = radius from the axis). */
  profile: Vec2[][]
  /** Node transform placing the plane-local solid in the world. */
  transform: Transform
  segments: number
  /** Height in mm (extrude) or sweep angle in degrees (revolve). */
  value: number
  /** Extrude toward -normal instead of +normal (ignored for revolve). */
  flip: boolean
  /** Editable source stored on the created solid, for later re-editing. */
  sketch: SketchSource
  /** Object whose face this sketch was drawn on (null for cardinal/datum planes). */
  sourceNodeId: NodeId | null
  /** How the result folds into `sourceNodeId` (ignored when it's null). */
  combine: CombineMode
}

/** What `start` accepts; `combine` is defaulted from `sourceNodeId`. */
export type NewOp = Omit<PendingOp, 'combine' | 'sourceNodeId'> & {
  sourceNodeId?: NodeId | null
}

function clampValue(mode: PendingOp['mode'], v: number): number {
  return mode === 'extrude' ? Math.max(0.1, v) : Math.max(1, Math.min(360, v))
}

interface OperationState {
  pending: PendingOp | null
  start: (op: NewOp) => void
  setValue: (value: number) => void
  /** Extrude only: a signed extent along +normal. Negative auto-flips and stores |value|. */
  setSignedValue: (signed: number) => void
  toggleFlip: () => void
  /** Choose how the result combines with the sketch's source object. */
  setCombine: (combine: CombineMode) => void
  confirm: () => void
  cancel: () => void
}

export const useOperationStore = create<OperationState>((set, get) => ({
  pending: null,
  start: (op) =>
    set({
      pending: {
        ...op,
        value: clampValue(op.mode, op.value),
        sourceNodeId: op.sourceNodeId ?? null,
        // Default to union when sketched on an object, else a standalone object.
        combine: op.sourceNodeId ? 'union' : 'new',
      },
    }),
  setValue: (value) =>
    set((s) =>
      s.pending ? { pending: { ...s.pending, value: clampValue(s.pending.mode, value) } } : {},
    ),
  setSignedValue: (signed) =>
    set((s) => {
      if (!s.pending) return {}
      if (s.pending.mode !== 'extrude') {
        return { pending: { ...s.pending, value: clampValue('revolve', signed) } }
      }
      return {
        pending: { ...s.pending, flip: signed < 0, value: clampValue('extrude', Math.abs(signed)) },
      }
    }),
  toggleFlip: () =>
    set((s) => (s.pending ? { pending: { ...s.pending, flip: !s.pending.flip } } : {})),
  setCombine: (combine) => set((s) => (s.pending ? { pending: { ...s.pending, combine } } : {})),
  confirm: () => {
    const op = get().pending
    if (!op) return
    const cad = useCadStore.getState()
    const combine: CombineTarget | undefined =
      op.sourceNodeId && op.combine !== 'new'
        ? { targetId: op.sourceNodeId, op: op.combine }
        : undefined
    if (op.mode === 'extrude')
      cad.addExtrusion(op.profile, op.value, op.transform, op.flip, op.sketch, combine)
    else cad.addRevolution(op.profile, op.value, op.segments, op.transform, op.sketch, combine)
    set({ pending: null })
  },
  cancel: () => set({ pending: null }),
}))
