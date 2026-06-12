/**
 * The section cutting plane drawn in the viewport: a rectangle outline + faint
 * fill perpendicular to the section axis, sized to the model bounds (with
 * margin) so it reads in empty space too. BuildVolume pattern: prefs/store
 * driven, memoized geometry, never raycasts.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useSectionStore } from './sectionStore'
import { useFitStore } from './fitStore'
import { usePrefsStore } from '../preferences/prefsStore'
import { useResolvedTheme } from '../preferences/useResolvedTheme'
import { VIEWPORT_THEMES } from './viewportTheme'

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

export function SectionPlaneVisual() {
  const enabled = useSectionStore((s) => s.enabled)
  const axis = useSectionStore((s) => s.axis)
  const offset = useSectionStore((s) => s.offset)
  const bounds = useFitStore((s) => s.bounds)
  const buildVolume = usePrefsStore((s) => s.buildVolume)
  const theme = VIEWPORT_THEMES[useResolvedTheme()]

  // Plane size + center: model bounds + 10% margin, else the build volume.
  const frame = useMemo(() => {
    const min = bounds ? bounds.min : [-buildVolume.x / 2, -buildVolume.y / 2, 0]
    const max = bounds ? bounds.max : [buildVolume.x / 2, buildVolume.y / 2, buildVolume.z]
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
    const i = AXIS_INDEX[axis]
    // [j, k] = world axes the rotated plane's local X / local Y land on
    // (setFromUnitVectors(z, axis) maps them as below).
    const [j, k] = i === 0 ? [2, 1] : i === 1 ? [0, 2] : [0, 1]
    const w = Math.max(size[j] * 1.1, 10)
    const h = Math.max(size[k] * 1.1, 10)
    return { w, h, center, i, j, k }
  }, [bounds, buildVolume, axis])

  const { quaternion, position } = useMemo(() => {
    const n = new THREE.Vector3()
    n.setComponent(frame.i, 1)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
    const p = new THREE.Vector3()
    p.setComponent(frame.i, offset)
    p.setComponent(frame.j, frame.center[frame.j])
    p.setComponent(frame.k, frame.center[frame.k])
    return { quaternion: q, position: p }
  }, [frame, offset])

  // PlaneGeometry is XY; rotated so its normal matches the section axis. Note
  // the plane's local X maps to world axis j only up to the quaternion choice —
  // sizing uses max(w, h) symmetry instead of exact per-axis mapping.
  const planeGeo = useMemo(() => new THREE.PlaneGeometry(frame.w, frame.h), [frame.w, frame.h])
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(planeGeo), [planeGeo])
  useEffect(
    () => () => {
      planeGeo.dispose()
      edgesGeo.dispose()
    },
    [planeGeo, edgesGeo],
  )

  if (!enabled) return null

  return (
    <group position={position} quaternion={quaternion}>
      <lineSegments geometry={edgesGeo} raycast={() => null}>
        <lineBasicMaterial
          color={theme.sectionPlane}
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </lineSegments>
      <mesh geometry={planeGeo} raycast={() => null}>
        <meshBasicMaterial
          color={theme.sectionPlane}
          transparent
          opacity={0.06}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}
