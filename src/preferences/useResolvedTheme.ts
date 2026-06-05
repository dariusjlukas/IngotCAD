/**
 * React glue for theming: a hook that yields the concrete light/dark theme
 * (re-rendering when the OS theme changes while following 'system'), and an
 * effect that mirrors it onto <html> and the <meta theme-color> tag.
 */
import { useEffect, useState } from 'react'
import { usePrefsStore } from './prefsStore'
import { resolveTheme, systemTheme, type ResolvedTheme } from './theme'

/** The theme that should actually render right now ('light' | 'dark'). */
export function useResolvedTheme(): ResolvedTheme {
  const pref = usePrefsStore((s) => s.theme)
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return pref === 'system' ? system : pref
}

const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#15161b', light: '#eef1f5' }

/** Keep <html> class + <meta theme-color> in sync with the resolved theme. */
export function useApplyTheme(): void {
  const pref = usePrefsStore((s) => s.theme)
  const resolved = useResolvedTheme()

  useEffect(() => {
    const el = document.documentElement
    el.classList.toggle('dark', resolved === 'dark')
    el.classList.toggle('light', resolved === 'light')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[resolved])
    // `pref` is a dep so switching to/from 'system' re-applies immediately.
  }, [resolved, pref])
}

export { resolveTheme }
