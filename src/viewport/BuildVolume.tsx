/**
 * The printer build volume: a wireframe box on the build plate showing the
 * usable print area (bed footprint in XY, machine height in Z). Centered on the
 * origin in XY and rising from z=0, matching where new objects are placed. Turns
 * a warning color when the model overflows the bed, mirroring the status-bar
 * fit warning. Purely decorative — it never participates in picking.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { usePrefsStore } from '../preferences/prefsStore'
import { useResolvedTheme } from '../preferences/useResolvedTheme'
import { VIEWPORT_THEMES } from './viewportTheme'
import { modelExceedsBuildVolume, useFitStore } from './fitStore'

export function BuildVolume() {
  const enabled = usePrefsStore((s) => s.buildVolumeEnabled)
  const volume = usePrefsStore((s) => s.buildVolume)
  const bounds = useFitStore((s) => s.bounds)
  const theme = VIEWPORT_THEMES[useResolvedTheme()]

  const edges = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(volume.x, volume.y, volume.z)),
    [volume.x, volume.y, volume.z],
  )
  useEffect(() => () => edges.dispose(), [edges])

  if (!enabled) return null

  const over = bounds ? modelExceedsBuildVolume(bounds, volume) : false
  const color = over ? theme.buildVolumeOver : theme.buildVolume

  return (
    <lineSegments geometry={edges} position={[0, 0, volume.z / 2]} raycast={() => null}>
      <lineBasicMaterial color={color} transparent opacity={over ? 0.85 : 0.5} depthWrite={false} />
    </lineSegments>
  )
}
