/**
 * A pending extrude/revolve operation, awaiting confirmation. After a sketch is
 * committed we don't create the solid immediately — we hold the profile + plane
 * here and show a live preview in 3D. The user scrubs the value (height/angle)
 * and confirms (one undo step via the cad store) or cancels (nothing happens).
 */
import { create } from 'zustand'
import type { Transform, Vec2 } from '../document/types'
import { useCadStore } from '../document/store'

export interface PendingOp {
  mode: 'extrude' | 'revolve'
  /** For extrude: recentered profile. For revolve: as drawn (x = radius). */
  profile: Vec2[][]
  /** Node transform placing the plane-local solid in the world. */
  transform: Transform
  segments: number
  /** Height in mm (extrude) or sweep angle in degrees (revolve). */
  value: number
  /** Extrude toward -normal instead of +normal (ignored for revolve). */
  flip: boolean
}

function clampValue(mode: PendingOp['mode'], v: number): number {
  return mode === 'extrude' ? Math.max(0.1, v) : Math.max(1, Math.min(360, v))
}

interface OperationState {
  pending: PendingOp | null
  start: (op: PendingOp) => void
  setValue: (value: number) => void
  /** Extrude only: a signed extent along +normal. Negative auto-flips and stores |value|. */
  setSignedValue: (signed: number) => void
  toggleFlip: () => void
  confirm: () => void
  cancel: () => void
}

export const useOperationStore = create<OperationState>((set, get) => ({
  pending: null,
  start: (op) => set({ pending: { ...op, value: clampValue(op.mode, op.value) } }),
  setValue: (value) =>
    set((s) => (s.pending ? { pending: { ...s.pending, value: clampValue(s.pending.mode, value) } } : {})),
  setSignedValue: (signed) =>
    set((s) => {
      if (!s.pending) return {}
      if (s.pending.mode !== 'extrude') {
        return { pending: { ...s.pending, value: clampValue('revolve', signed) } }
      }
      return { pending: { ...s.pending, flip: signed < 0, value: clampValue('extrude', Math.abs(signed)) } }
    }),
  toggleFlip: () => set((s) => (s.pending ? { pending: { ...s.pending, flip: !s.pending.flip } } : {})),
  confirm: () => {
    const op = get().pending
    if (!op) return
    const cad = useCadStore.getState()
    if (op.mode === 'extrude') cad.addExtrusion(op.profile, op.value, op.transform, op.flip)
    else cad.addRevolution(op.profile, op.value, op.segments, op.transform)
    set({ pending: null })
  },
  cancel: () => set({ pending: null }),
}))
