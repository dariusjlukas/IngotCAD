/**
 * Smoothly flies the camera to frame a requested target (e.g. on double-click),
 * keeping the current viewing direction and dollying to fit the object's
 * bounding sphere. One useFrame loop drives all focus animations.
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function CameraController() {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null
  const invalidate = useThree((s) => s.invalidate)
  const focusTarget = useViewportStore((s) => s.focusTarget)
  const resetNonce = useViewportStore((s) => s.resetNonce)

  const anim = useRef({
    active: false,
    t: 0,
    fromPos: new THREE.Vector3(),
    toPos: new THREE.Vector3(),
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  })

  useEffect(() => {
    if (!focusTarget || !controls) return
    const center = new THREE.Vector3(...focusTarget.center)
    const radius = Math.max(focusTarget.radius, 0.5)

    const persp = camera as THREE.PerspectiveCamera
    const fov = ((persp.isPerspectiveCamera ? persp.fov : 45) * Math.PI) / 180
    const distance = (radius / Math.sin(fov / 2)) * 1.4 // padding

    // Keep the current view direction.
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(1, -1, 1)
    dir.normalize()

    const a = anim.current
    a.fromPos.copy(camera.position)
    a.toPos.copy(center).addScaledVector(dir, distance)
    a.fromTarget.copy(controls.target)
    a.toTarget.copy(center)
    a.t = 0
    a.active = true
    invalidate() // kick off the on-demand render loop for the fly-to
    // Re-fire whenever a new focus is requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.nonce])

  // Fly back to the home view when the user clicks the reset/home button.
  useEffect(() => {
    if (resetNonce === 0 || !controls) return
    const a = anim.current
    a.fromPos.copy(camera.position)
    a.toPos.set(...DEFAULT_CAMERA_POSITION)
    a.fromTarget.copy(controls.target)
    a.toTarget.set(...DEFAULT_CAMERA_TARGET)
    a.t = 0
    a.active = true
    invalidate() // kick off the on-demand render loop for the fly-back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetNonce])

  useFrame((_, delta) => {
    const a = anim.current
    if (!a.active || !controls) return
    a.t = Math.min(1, a.t + delta / DURATION)
    const e = easeInOutCubic(a.t)
    camera.position.lerpVectors(a.fromPos, a.toPos, e)
    controls.target.lerpVectors(a.fromTarget, a.toTarget, e)
    controls.update()
    if (a.t >= 1) a.active = false
    else invalidate() // request the next frame until the animation finishes
  })

  return null
}
