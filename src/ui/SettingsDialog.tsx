/** App settings: appearance (theme), viewport (grid), and about. Modal dialog. */
import type { ReactNode } from 'react'
import { Modal } from './Modal'
import { useDialogStore } from './dialogStore'
import { usePrefsStore } from '../preferences/prefsStore'
import type { ThemePreference } from '../preferences/prefsStore'

const APP_VERSION = '0.1.0'

const THEMES: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-fg-muted">{label}</span>
      {children}
    </div>
  )
}

export function SettingsDialog() {
  const open = useDialogStore((s) => s.open)
  const setOpen = useDialogStore((s) => s.setOpen)
  const theme = usePrefsStore((s) => s.theme)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const gridEnabled = usePrefsStore((s) => s.gridEnabled)
  const setGridEnabled = usePrefsStore((s) => s.setGridEnabled)

  if (open !== 'settings') return null

  return (
    <Modal title="Settings" onClose={() => setOpen(null)}>
      <Section title="Appearance">
        <Row label="Theme">
          <div className="flex overflow-hidden rounded border border-line-strong">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={
                  'px-2.5 py-1 text-xs ' +
                  (theme === t.id ? 'bg-accent text-on-accent' : 'text-fg-muted hover:bg-elevated')
                }
              >
                {t.label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Viewport">
        <Row label="Show build-plate grid">
          <button
            type="button"
            role="switch"
            aria-checked={gridEnabled}
            onClick={() => setGridEnabled(!gridEnabled)}
            className={
              'relative h-5 w-9 shrink-0 rounded-full transition-colors ' +
              (gridEnabled ? 'bg-accent' : 'bg-line-strong')
            }
          >
            <span
              className={
                'absolute top-0.5 h-4 w-4 rounded-full bg-on-accent transition-all ' +
                (gridEnabled ? 'left-[18px]' : 'left-0.5')
              }
            />
          </button>
        </Row>
        <Row label="Units">
          <span className="text-sm text-fg">mm · Z-up</span>
        </Row>
      </Section>

      <Section title="About">
        <p className="text-sm text-fg">
          Ingot CAD <span className="text-fg-faint">v{APP_VERSION}</span>
        </p>
        <p className="text-xs text-fg-faint">
          Open-source, web-based 3D CAD for hobbyist 3D printing. Apache-2.0 licensed.
        </p>
      </Section>
    </Modal>
  )
}
