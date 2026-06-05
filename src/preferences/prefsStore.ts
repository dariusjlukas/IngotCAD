/**
 * User preferences: appearance + viewport display settings. Persisted to
 * localStorage so they survive reloads. Kept separate from the CAD document
 * store (which is undoable/serialized on its own) and from the transient
 * viewport store (gizmo mode etc.).
 *
 * NOTE: the localStorage key ('ingot-prefs') and the persisted shape
 * ({ state: { theme, … } }) are read by the bootstrap script in index.html to
 * set the theme class before first paint. Keep them in sync.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type ThemePreference = 'system' | 'light' | 'dark'

interface PrefsState {
  /** Appearance: follow the OS, or force light/dark. */
  theme: ThemePreference
  /** Show the build-plate grid in the viewport. */
  gridEnabled: boolean
  /** Grid extent in mm (gridHelper size). */
  gridSize: number

  setTheme: (theme: ThemePreference) => void
  setGridEnabled: (gridEnabled: boolean) => void
  setGridSize: (gridSize: number) => void
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      gridEnabled: true,
      gridSize: 400,
      setTheme: (theme) => set({ theme }),
      setGridEnabled: (gridEnabled) => set({ gridEnabled }),
      setGridSize: (gridSize) => set({ gridSize }),
    }),
    {
      name: 'ingot-prefs',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Persist data only (actions aren't serializable); also pins the stored
      // shape the index.html bootstrap script depends on.
      partialize: (s) => ({ theme: s.theme, gridEnabled: s.gridEnabled, gridSize: s.gridSize }),
    },
  ),
)
