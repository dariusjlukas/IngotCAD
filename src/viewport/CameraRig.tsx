/**
 * Owns the viewport camera and swaps between perspective and orthographic
 * projection without jumping the view: each frame it records a
 * projection-independent framing (target, view direction, and the world height
 * visible at the target), and when the projection changes it positions /
 * zooms the freshly-mounted camera to reproduce that framing.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera, PerspectiveCamera } from '@react-three/drei'
import { usePrefsStore } from '../preferences/prefsStore'
import { DEFAULT_CAMERA_POSITION, useViewportStore } from './viewportStore'

const FOV = 45
// For an orthographic camera the position distance doesn't affect scale (only
// clipping), so we park it at a fixed, comfortably-inside-the-frustum distance.
const ORTHO_DISTANCE = 2000

interface OrbitLike {
  target: THREE.Vector3
  update: () => void
}

export function CameraRig() {
  const projection = usePrefsStore((s) => s.projection)
  // The sketch camera lock forces orthographic for the whole sketch session
  // (parallel projection aligns the locked camera with the flat SVG overlay, and
  // staying ortho across both fly-in/out animations avoids interpolating the
  // projection). The persisted pref is untouched and takes over again on exit.
  const sketchCamPhase = useViewportStore((s) => s.sketchCamPhase)
  // `camera` drives the effect's dependency (it changes on a projection swap);
  // `get()` is used to read it fresh inside handlers so we can mutate it.
  const camera = useThree((s) => s.camera)
  const get = useThree((s) => s.get)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  const sizeHeight = useThree((s) => s.size.height)
  const invalidate = useThree((s) => s.invalidate)

  const pose = useRef({
    target: new THREE.Vector3(),
    dir: new THREE.Vector3(...DEFAULT_CAMERA_POSITION).normalize(),
    visibleHeight: 200,
  })

  useFrame((state) => {
    // During a sketch (and its fly-in/out) SketchCameraLock owns the camera.
    // Don't record that pose, or the pre-sketch framing is lost on exit.
    if (useViewportStore.getState().sketchCamPhase !== 'idle') return
    const cam = state.camera
    const target = controls?.target ?? pose.current.target
    const offset = new THREE.Vector3().subVectors(cam.position, target)
    const dist = offset.length() || 1
    pose.current.target.copy(target)
    pose.current.dir.copy(offset).multiplyScalar(1 / dist)
    const ortho = cam as THREE.OrthographicCamera
    pose.current.visibleHeight = ortho.isOrthographicCamera
      ? state.size.height / ortho.zoom
      : 2 * dist * Math.tan((((cam as THREE.PerspectiveCamera).fov || FOV) * Math.PI) / 360)
  })

  // The default camera instance changes when the projection swaps; reproduce the
  // recorded framing on the new camera. On the very first mount, leave a
  // perspective camera exactly as the Canvas set it, but initialize an
  // orthographic camera to the equivalent HOME framing (its default zoom of 1
  // would otherwise show ~3× too much world — the old "everything starts tiny"
  // bug). `controls` is a dependency because it registers AFTER this rig
  // mounts and the startup init needs it; `seenCamera` gates the reframe so
  // those extra startup firings (controls arriving, store subscriptions
  // settling) can't re-apply a pose recorded from the uninitialized camera.
  const first = useRef(true)
  const seenCamera = useRef<THREE.Camera | null>(null)
  useEffect(() => {
    if (!controls) return
    // During a sketch (and its fly-in/out) SketchCameraLock owns the framing, so
    // skip the projection-swap reframing here. Once idle again this runs normally
    // and reproduces the pre-sketch framing on the swapped-back camera.
    if (useViewportStore.getState().sketchCamPhase !== 'idle') {
      first.current = false
      seenCamera.current = get().camera
      return
    }
    const cam = get().camera
    if (seenCamera.current === cam) return // same camera — nothing to (re)frame
    seenCamera.current = cam
    const ortho = cam as THREE.OrthographicCamera
    if (first.current) {
      first.current = false
      if (!ortho.isOrthographicCamera) return
      // Startup in orthographic: reproduce the perspective HOME framing
      // deterministically (the pose recorder may have run against the
      // uninitialized camera, so its values can't be trusted here).
      const home = new THREE.Vector3(...DEFAULT_CAMERA_POSITION)
      const homeVisible = 2 * home.length() * Math.tan((FOV * Math.PI) / 360)
      cam.position.copy(home.normalize().multiplyScalar(ORTHO_DISTANCE))
      ortho.zoom = sizeHeight / Math.max(1, homeVisible)
      ortho.updateProjectionMatrix()
      controls.target.set(0, 0, 0)
      controls.update()
      invalidate()
      return
    }
    const p = pose.current
    if (ortho.isOrthographicCamera) {
      cam.position.copy(p.target).addScaledVector(p.dir, ORTHO_DISTANCE)
      ortho.zoom = sizeHeight / Math.max(1, p.visibleHeight)
      ortho.updateProjectionMatrix()
    } else {
      const dist = p.visibleHeight / (2 * Math.tan((FOV * Math.PI) / 360))
      cam.position.copy(p.target).addScaledVector(p.dir, dist)
    }
    controls.target.copy(p.target)
    controls.update()
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls])

  return projection === 'orthographic' || sketchCamPhase !== 'idle' ? (
    <OrthographicCamera makeDefault near={0.1} far={20000} position={DEFAULT_CAMERA_POSITION} />
  ) : (
    <PerspectiveCamera
      makeDefault
      fov={FOV}
      near={0.1}
      far={10000}
      position={DEFAULT_CAMERA_POSITION}
    />
  )
}
