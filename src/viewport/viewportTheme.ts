/**
 * Per-theme colors and light levels for the 3D scene. WebGL can't read the CSS
 * tokens in index.css, so the viewport pulls its chrome colors from here keyed
 * by the resolved theme. Object colors, gizmo axis colors and tool affordances
 * are content/identity colors and intentionally live elsewhere (not here).
 */
import type { ResolvedTheme } from '../preferences/theme'

export interface ViewportTheme {
  background: string
  gridMajor: string
  gridMinor: string
  /** Emissive tint applied to a selected mesh. */
  selectionEmissive: string
  /** Crisp edge-outline color drawn around a selected mesh. */
  selectionOutline: string
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  keyIntensity: number
  fillIntensity: number
  ambientIntensity: number
}

export const VIEWPORT_THEMES: Record<ResolvedTheme, ViewportTheme> = {
  dark: {
    background: '#15161b',
    gridMajor: '#46506b',
    // Brighter than you'd expect for a "minor" line: drei's Grid renders cell
    // lines at 0.75x alpha with AA, so a near-background value washes out.
    gridMinor: '#343c50',
    selectionEmissive: '#1d4ed8',
    selectionOutline: '#8ab4ff',
    hemiSky: '#ffffff',
    hemiGround: '#3a3f4b',
    hemiIntensity: 0.65,
    keyIntensity: 1.1,
    fillIntensity: 0.35,
    ambientIntensity: 0.25,
  },
  light: {
    background: '#eef1f5',
    gridMajor: '#aeb6c7',
    // Darker than the old value so the minor lines survive drei's 0.75x cell-line
    // dimming against the light background.
    gridMinor: '#c3cad7',
    selectionEmissive: '#2563eb',
    selectionOutline: '#1d4ed8',
    hemiSky: '#ffffff',
    hemiGround: '#c9ccd2',
    hemiIntensity: 0.9,
    keyIntensity: 1.0,
    fillIntensity: 0.3,
    ambientIntensity: 0.5,
  },
}
