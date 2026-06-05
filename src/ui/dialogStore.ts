/** Which app-level modal dialog is open (only one at a time). */
import { create } from 'zustand'

export type DialogId = 'settings' | 'shortcuts' | null

interface DialogState {
  open: DialogId
  setOpen: (open: DialogId) => void
}

export const useDialogStore = create<DialogState>((set) => ({
  open: null,
  setOpen: (open) => set({ open }),
}))
