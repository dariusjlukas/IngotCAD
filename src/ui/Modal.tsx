/** A centered modal dialog over a dimming scrim. Escape and scrim-click close. */
import { useEffect, type ReactNode } from 'react'

export function Modal({
  title,
  onClose,
  children,
  widthClass = 'max-w-md',
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  widthClass?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${widthClass} overflow-hidden rounded-lg border border-line-strong bg-panel text-fg shadow-2xl`}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg-strong">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-fg-faint hover:bg-elevated hover:text-fg"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}
