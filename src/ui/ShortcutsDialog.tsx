/** A reference overlay listing the app's keyboard shortcuts. Modal dialog. */
import { Modal } from './Modal'
import { useDialogStore } from './dialogStore'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'File',
    items: [
      ['⌘N', 'New project'],
      ['⌘O', 'Open project'],
      ['⌘S', 'Save'],
      ['⇧⌘S', 'Save As…'],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['⌘Z', 'Undo'],
      ['⇧⌘Z', 'Redo'],
      ['⌘D', 'Duplicate'],
      ['⌘C', 'Copy'],
      ['⌘V', 'Paste'],
      ['⌫', 'Delete selection'],
    ],
  },
  {
    title: 'Tools',
    items: [
      ['Q', 'Select'],
      ['W', 'Move'],
      ['E', 'Rotate'],
      ['R', 'Scale'],
    ],
  },
  {
    title: 'Selection & view',
    items: [
      ['F', 'Frame selected'],
      ['Esc', 'Deselect'],
    ],
  },
  {
    title: 'Help',
    items: [['?', 'Show this list']],
  },
]

export function ShortcutsDialog() {
  const open = useDialogStore((s) => s.open)
  const setOpen = useDialogStore((s) => s.setOpen)

  if (open !== 'shortcuts') return null

  return (
    <Modal title="Keyboard Shortcuts" onClose={() => setOpen(null)} widthClass="max-w-sm">
      <p className="mb-3 text-xs text-fg-faint">On Windows/Linux, use Ctrl in place of ⌘.</p>
      <div className="space-y-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
              {group.title}
            </h3>
            <dl className="space-y-1">
              {group.items.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-3">
                  <dt className="text-sm text-fg">{label}</dt>
                  <dd>
                    <kbd className="rounded border border-line-strong bg-elevated px-1.5 py-0.5 text-xs text-fg-strong">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Modal>
  )
}
