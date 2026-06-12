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
export type CameraProjection = 'perspective' | 'orthographic'

/** Printer build volume in mm (X = width, Y = depth, Z = height). */
export interface BuildVolume {
  x: number
  y: number
  z: number
}

/** A common 256³ printer bed (e.g. Bambu X1/P1). */
export const DEFAULT_BUILD_VOLUME: BuildVolume = { x: 256, y: 256, z: 256 }

interface PrefsState {
  /** Appearance: follow the OS, or force light/dark. */
  theme: ThemePreference
  /** Show the build-plate grid in the viewport. */
  gridEnabled: boolean
  /**
   * Smooth (auto-smooth) shading: average vertex normals across soft edges while
   * keeping sharp edges crisp (like Blender's "Smooth by Angle"). Off = faceted.
   */
  smoothShading: boolean
  /** Camera projection for the viewport. */
  projection: CameraProjection
  /** Draw the printer build volume (bed outline + height) in the viewport. */
  buildVolumeEnabled: boolean
  /** Printer build volume in mm, centered on the origin in XY, rising from z=0. */
  buildVolume: BuildVolume

  setTheme: (theme: ThemePreference) => void
  setGridEnabled: (gridEnabled: boolean) => void
  setSmoothShading: (smoothShading: boolean) => void
  setProjection: (projection: CameraProjection) => void
  setBuildVolumeEnabled: (buildVolumeEnabled: boolean) => void
  setBuildVolume: (buildVolume: BuildVolume) => void
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      theme: 'system',
      gridEnabled: true,
      smoothShading: true,
      projection: 'orthographic',
      buildVolumeEnabled: false,
      buildVolume: DEFAULT_BUILD_VOLUME,
      setTheme: (theme) => set({ theme }),
      setGridEnabled: (gridEnabled) => set({ gridEnabled }),
      setSmoothShading: (smoothShading) => set({ smoothShading }),
      setProjection: (projection) => set({ projection }),
      setBuildVolumeEnabled: (buildVolumeEnabled) => set({ buildVolumeEnabled }),
      setBuildVolume: (buildVolume) => set({ buildVolume }),
    }),
    {
      name: 'ingot-prefs',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // Persist data only (actions aren't serializable); also pins the stored
      // shape the index.html bootstrap script depends on. New fields merge over
      // these defaults for docs saved before they existed (missing → default).
      partialize: (s) => ({
        theme: s.theme,
        gridEnabled: s.gridEnabled,
        smoothShading: s.smoothShading,
        projection: s.projection,
        buildVolumeEnabled: s.buildVolumeEnabled,
        buildVolume: s.buildVolume,
      }),
    },
  ),
)
