/**
 * A single cursor-positioned context menu, opened imperatively from anywhere via
 * `openContextMenu(x, y, items)` and rendered by <ContextMenuHost>. Plus two
 * small guards the viewport uses: one so an object right-click doesn't also open
 * the empty-space menu, and one so a right-drag (orbit pan) doesn't open a menu.
 */
import { create } from 'zustand'

export interface ContextMenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
}

export type ContextMenuEntry = ContextMenuItem | 'separator'

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextMenuEntry[]
  openMenu: (x: number, y: number, items: ContextMenuEntry[]) => void
  close: () => void
}

export const useContextMenuStore = create<ContextMenuState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  openMenu: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}))

export function openContextMenu(x: number, y: number, items: ContextMenuEntry[]): void {
  useContextMenuStore.getState().openMenu(x, y, items)
}

// --- viewport guards -------------------------------------------------------

let objectHandled = false

/** Called by an object right-click so the viewport's empty-space menu stands down. */
export function markObjectMenuHandled(): void {
  objectHandled = true
  queueMicrotask(() => {
    objectHandled = false
  })
}

export function wasObjectMenuHandled(): boolean {
  return objectHandled
}

let rightDownPos: { x: number; y: number } | null = null

/** Record where a right-button press started (to tell a click from a pan-drag). */
export function noteRightButtonDown(x: number, y: number): void {
  rightDownPos = { x, y }
}

/** True if the pointer moved meaningfully since the right-button press (a pan). */
export function rightButtonDragged(x: number, y: number): boolean {
  return rightDownPos != null && Math.hypot(x - rightDownPos.x, y - rightDownPos.y) > 6
}
