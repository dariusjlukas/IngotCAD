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
    gridMinor: '#262a33',
    selectionEmissive: '#1d4ed8',
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
    gridMinor: '#d3d8e0',
    selectionEmissive: '#2563eb',
    hemiSky: '#ffffff',
    hemiGround: '#c9ccd2',
    hemiIntensity: 0.9,
    keyIntensity: 1.0,
    fillIntensity: 0.3,
    ambientIntensity: 0.5,
  },
}
