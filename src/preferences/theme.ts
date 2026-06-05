/** Theme resolution: turn a preference into the concrete theme to render. */
import type { ThemePreference } from './prefsStore'

export type ResolvedTheme = 'light' | 'dark'

export function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}
