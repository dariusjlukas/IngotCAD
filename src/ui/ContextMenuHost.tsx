/** Renders the active context menu at its cursor position. Closes on outside
 * click, Escape, scroll, or window blur. Mounted once at the app root. */
import { useEffect } from 'react'
import { useContextMenuStore } from './contextMenuStore'

const EST_ROW_H = 30 // px, for clamping the menu inside the viewport

export function ContextMenuHost() {
  const open = useContextMenuStore((s) => s.open)
  const x = useContextMenuStore((s) => s.x)
  const y = useContextMenuStore((s) => s.y)
  const items = useContextMenuStore((s) => s.items)
  const close = useContextMenuStore((s) => s.close)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  if (!open) return null

  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - (items.length * EST_ROW_H + 12))

  return (
    <>
      {/* Full-screen catcher closes the menu on any outside click. */}
      <div
        className="fixed inset-0 z-[65]"
        onPointerDown={close}
        onContextMenu={(e) => {
          e.preventDefault()
          close()
        }}
      />
      <div
        role="menu"
        style={{ left, top }}
        className="fixed z-[70] min-w-44 rounded-md border border-line-strong bg-panel p-1 shadow-xl"
      >
        {items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="my-1 h-px bg-line" />
          ) : (
            <button
              key={i}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect()
                close()
              }}
              className={
                'flex w-full items-center rounded px-2 py-1.5 text-left text-sm ' +
                (item.danger
                  ? 'text-danger hover:bg-danger-surface '
                  : 'text-fg hover:bg-accent hover:text-on-accent ') +
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg'
              }
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  )
}
