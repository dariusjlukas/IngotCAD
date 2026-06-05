/**
 * A minimal menu-bar dropdown. Each <Menu> owns its open state; opening one
 * closes the others (via a window event), clicking outside or pressing Escape
 * closes it, and once any menu is open, hovering a sibling switches to it
 * (classic menu-bar behavior). <MenuItem>/<MenuSeparator> compose the contents.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

const MENU_OPEN_EVENT = 'ingot:menu-open'
// True while any menu in the bar is open, so hover can switch between them.
let barActive = false

const CloseMenuContext = createContext<() => void>(() => {})

export function Menu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)

  const close = () => {
    barActive = false
    setOpen(false)
  }
  const openThis = () => {
    barActive = true
    window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT, { detail: id }))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Another menu opened — close this one.
    const onOtherOpen = (e: Event) => {
      if ((e as CustomEvent).detail !== id) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener(MENU_OPEN_EVENT, onOtherOpen)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener(MENU_OPEN_EVENT, onOtherOpen)
    }
  }, [open, id])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : openThis())}
        onPointerEnter={() => {
          if (barActive && !open) openThis()
        }}
        className={
          'rounded px-2 py-1 text-sm transition-colors ' +
          (open ? 'bg-elevated text-fg-strong' : 'text-fg hover:bg-elevated')
        }
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-48 rounded-md border border-line-strong bg-panel p-1 shadow-xl"
        >
          <CloseMenuContext.Provider value={close}>{children}</CloseMenuContext.Provider>
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  onSelect,
  disabled,
  shortcut,
  checked,
  children,
}: {
  onSelect: () => void
  disabled?: boolean
  /** Right-aligned shortcut hint, e.g. "⌘S". */
  shortcut?: string
  /** When defined, a leading check mark slot is reserved and filled if true. */
  checked?: boolean
  children: ReactNode
}) {
  const close = useContext(CloseMenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect()
        close()
      }}
      className={
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ' +
        'text-fg hover:bg-accent hover:text-on-accent ' +
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg'
      }
    >
      {checked !== undefined && (
        <span className="w-3 shrink-0 text-center text-xs">{checked ? '✓' : ''}</span>
      )}
      <span className="flex-1 whitespace-nowrap">{children}</span>
      {shortcut && <span className="shrink-0 text-xs text-fg-faint">{shortcut}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
      {children}
    </div>
  )
}
