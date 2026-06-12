/**
 * Smoothly flies the camera to frame a requested target (e.g. on double-click
 * or the F key), keeping the current viewing direction. Framing is
 * projection-aware: a perspective camera dollies to fit the object's bounding
 * sphere; an orthographic camera keeps its parked distance and animates `zoom`
 * instead (in ortho, apparent size is zoom — moving the camera changes nothing).
 * One useFrame loop drives all focus animations.
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_TARGET, useViewportStore } from './viewportStore'

// Minimal shape of the default OrbitControls we drive.
interface OrbitLike {
  target: THREE.Vector3
  update: () => void
}

const DURATION = 0.45 // seconds
/**
 * Cap on the per-frame time step while animating. With on-demand rendering the
 * first frame after an idle gap reports a huge delta (time since the LAST
 * rendered frame), which would jump the tween straight to its end pose.
 */
const MAX_FRAME_DELTA = 1 / 30
/** Matches the perspective camera in CameraRig / the Canvas. */
const FOV_FALLBACK = 45
/**
 * Padding factor for framing: the focused bounding sphere fills 1/1.4 of the
 * view height (the sphere subtends sin(fov/2)/1.4 in perspective; ortho uses
 * the equivalent visible height so both projections frame identically).
 */
const FIT_PADDING = 1.4

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** World height visible at the target for a perspective fit of `radius`. */
function fitVisibleHeight(radius: number, fovDeg: number): number {
  const half = (fovDeg * Math.PI) / 360
  // distance = radius / sin(half) * padding; visible = 2 * distance * tan(half)
  return ((2 * radius) / Math.sin(half)) * Math.tan(half) * FIT_PADDING
}

export function CameraController() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  const sizeHeight = useThree((s) => s.size.height)
  const invalidate = useThree((s) => s.invalidate)
  const focusTarget = useViewportStore((s) => s.focusTarget)
  const resetNonce = useViewportStore((s) => s.resetNonce)
  const viewRequest = useViewportStore((s) => s.viewRequest)

  const anim = useRef({
    active: false,
    t: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
    // Orthographic framing animates zoom; perspective leaves it alone.
    animateZoom: false,
    fromZoom: 1,
    toZoom: 1,
  })

  /** Begin a tween from the camera's current pose. */
  const start = (toPos: THREE.Vector3, toTarget: THREE.Vector3, toZoom: number | null) => {
    if (!controls) return
    const a = anim.current
    a.fromPos.copy(camera.position)
    a.toPos.copy(toPos)
    a.fromTarget.copy(controls.target)
    a.toTarget.copy(toTarget)
    const ortho = camera as THREE.OrthographicCamera
    a.animateZoom = toZoom !== null && ortho.isOrthographicCamera === true
    if (a.animateZoom) {
      a.fromZoom = ortho.zoom
      a.toZoom = toZoom!
    }
    a.t = 0
    a.active = true
    invalidate() // kick off the on-demand render loop for the tween
  }

  useEffect(() => {
    // SketchCameraLock owns the camera during a sketch + its fly-in/out.
    if (useViewportStore.getState().sketchCamPhase !== 'idle') return
    if (!focusTarget || !controls) return
    const center = new THREE.Vector3(...focusTarget.center)
    const radius = Math.max(focusTarget.radius, 0.5)

    const persp = camera as THREE.PerspectiveCamera
    const fov = persp.isPerspectiveCamera ? persp.fov : FOV_FALLBACK

    // Keep the current view direction.
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(1, -1, 1)
    dir.normalize()

    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      // Recenter at the parked distance; the actual framing is the zoom.
      const distance = camera.position.distanceTo(controls.target) || 2000
      const toPos = center.clone().addScaledVector(dir, distance)
      start(toPos, center, sizeHeight / fitVisibleHeight(radius, FOV_FALLBACK))
    } else {
      const distance = (radius / Math.sin((fov * Math.PI) / 360)) * FIT_PADDING
      start(center.clone().addScaledVector(dir, distance), center, null)
    }
    // Re-fire whenever a new focus is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce])

  // Fly back to the home view when the user clicks the reset/home button.
  useEffect(() => {
    if (useViewportStore.getState().sketchCamPhase !== 'idle') return
    if (resetNonce === 0 || !controls) return
    const homePos = new THREE.Vector3(...DEFAULT_CAMERA_POSITION)
    const homeTarget = new THREE.Vector3(...DEFAULT_CAMERA_TARGET)
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      // Same home direction, parked distance; zoom reproduces the home framing
      // (the world height a perspective camera would see from the home pose).
      const homeDir = homePos.clone().sub(homeTarget).normalize()
      const distance = camera.position.distanceTo(controls.target) || 2000
      const homeVisible =
        2 * homePos.distanceTo(homeTarget) * Math.tan((FOV_FALLBACK * Math.PI) / 360)
      start(
        homeTarget.clone().addScaledVector(homeDir, distance),
        homeTarget,
        sizeHeight / homeVisible,
      )
    } else {
      start(homePos, homeTarget, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce])

  // Snap to a named view (Top/Front/Right/Iso): keep the target + distance, just
  // rotate the camera to look along the requested direction.
  useEffect(() => {
    if (useViewportStore.getState().sketchCamPhase !== 'idle') return
    if (!viewRequest || !controls) return
    const dir = new THREE.Vector3(...viewRequest.dir)
    if (dir.lengthSq() < 1e-9) return
    dir.normalize()
    const distance = camera.position.distanceTo(controls.target) || 200
    start(controls.target.clone().addScaledVector(dir, distance), controls.target.clone(), null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRequest?.nonce])

  useFrame((state, delta) => {
    const a = anim.current
    if (useViewportStore.getState().sketchCamPhase !== 'idle' || !a.active || !controls) return
    a.t = Math.min(1, a.t + Math.min(delta, MAX_FRAME_DELTA) / DURATION)
    const e = easeInOutCubic(a.t)
    // Mutate via the frame state's camera (not the hook-returned value), per the
    // immutability lint rule — it's the same live default camera.
    const cam = state.camera
    cam.position.lerpVectors(a.fromPos, a.toPos, e)
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e)
    if (a.animateZoom) {
      const ortho = cam as THREE.OrthographicCamera
      if (ortho.isOrthographicCamera) {
        ortho.zoom = THREE.MathUtils.lerp(a.fromZoom, a.toZoom, e)
        ortho.updateProjectionMatrix()
      }
    }
    controls.update()
    if (a.t >= 1) a.active = false
    else invalidate() // request the next frame until the animation finishes
  })

  return null
}
