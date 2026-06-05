/** Renders the stack of active toasts (bottom-center). Click one to dismiss. */
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faCircleCheck, faCircleExclamation, faCircleInfo } from '@fortawesome/free-solid-svg-icons'
import { useToastStore, type ToastKind } from './toastStore'

const ICON: Record<ToastKind, IconDefinition> = {
  success: faCircleCheck,
  error: faCircleExclamation,
  info: faCircleInfo,
}

const ICON_COLOR: Record<ToastKind, string> = {
  success: 'text-accent',
  error: 'text-danger',
  info: 'text-fg-muted',
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className="pointer-events-auto flex max-w-[90vw] items-center gap-2 rounded-md border border-line-strong bg-panel px-3 py-2 text-sm text-fg shadow-lg"
        >
          <FontAwesomeIcon icon={ICON[t.kind]} className={`${ICON_COLOR[t.kind]} shrink-0`} />
          <span className="truncate">{t.message}</span>
        </button>
      ))}
    </div>
  )
}
