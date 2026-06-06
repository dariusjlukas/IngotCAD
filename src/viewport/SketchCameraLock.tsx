/**
 * Locks the viewport camera onto the active sketch plane, in pixel-perfect
 * alignment with the SVG sketch surface that App overlays on top while sketching.
 *
 * It's purely a visual trick — the sketch logic is untouched. We point an
 * orthographic camera straight down the plane normal and match its framing to
 * the sketch's pan/zoom (`view`), so the real 3D scene reads as the backdrop for
 * the 2D sketch instead of being hidden behind an opaque canvas.
 *
 * The SVG uses a square viewBox of side `view.size` mm centered at (cx, cy) with
 * preserveAspectRatio="meet" (model y → screen -y). An ortho camera with
 *   target = origin + cx·u + cy·v,  view dir = −n,  up = v,
 *   zoom   = height / (view.size · max(1, height/width))
 * reproduces that mapping exactly (camera-right resolves to u, since n = u×v).
 *
 * Transitions are animated rather than snapped. The whole sketch session runs in
 * orthographic (CameraRig forces it for any non-idle phase), so entry/exit are a
 * pure orientation slerp + zoom lerp between the prior 3D framing (reproduced as
 * an ortho pose) and the docked plane pose — no projection to interpolate. The
 * one perspective↔ortho swap at each docked end is seamless because the poses
 * match. The sketch SVG + scrim are revealed only once docked (`locked`), so the
 * 2D lines never sit over a moving backdrop. See SketchCamPhase in viewportStore.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useSketchStore } from '../sketch/sketchStore'
import { usePrefsStore, type CameraProjection } from '../preferences/prefsStore'
import { useViewportStore } from './viewportStore'

interface OrbitLike {
  target: THREE.Vector3
  enabled: boolean
  update: () => void
}

// Park the ortho camera this far off the plane along its normal. Ortho scale is
// set by zoom (not distance), so this only needs to clear `near` and sit inside
// `far` (0.1 / 20000 in CameraRig) regardless of where the plane sits in space.
const LOCK_DISTANCE = 2000
const DURATION = 0.45 // seconds — matches CameraController's fly-to
const FOV = 45 // matches the perspective camera in CameraRig / the Canvas
// Nudge the clip plane this far toward the camera (+n) so a face coplanar with
// the sketch plane lands cleanly inside the kept half-space. Right at the plane
// its fragments sit at signed distance ≈ 0, where float noise dithers the cut
// into a tiling/z-fighting pattern; the offset is sub-print-resolution (mm).
const CLIP_EPSILON = 0.05
// Extra frames to paint after a tween ends so the remounted grid + swapped-back
// camera converge under on-demand rendering (otherwise the grid can look stale).
const SETTLE_FRAMES = 4

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Orientation (as a quaternion) so the camera at `eye` looks at `target` with `up`. */
function lookQuat(eye: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(eye, target, up)
  return new THREE.Quaternion().setFromRotationMatrix(m)
}

/** A projection-independent camera pose for the (always-ortho) sketch view. */
interface Pose {
  target: THREE.Vector3
  quat: THREE.Quaternion
  zoom: number
}

interface Snapshot {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
  zoom: number
  fov: number
  projection: CameraProjection
}

const isOrtho = (cam: THREE.Camera): boolean =>
  (cam as THREE.OrthographicCamera).isOrthographicCamera === true

/** Apply an ortho pose to the camera (position derived from the orientation). */
function applyPose(cam: THREE.Camera, controls: OrbitLike | null, pose: Pose) {
  cam.quaternion.copy(pose.quat)
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(pose.quat)
  cam.position.copy(pose.target).addScaledVector(back, LOCK_DISTANCE)
  cam.up.copy(new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quat))
  if (isOrtho(cam)) (cam as THREE.OrthographicCamera).zoom = pose.zoom
  ;(cam as THREE.OrthographicCamera).updateProjectionMatrix()
  if (controls) controls.target.copy(pose.target)
}

export function SketchCameraLock() {
  const active = useSketchStore((s) => s.active)
  const plane = useSketchStore((s) => s.plane)
  const view = useSketchStore((s) => s.view)
  const phase = useViewportStore((s) => s.sketchCamPhase)
  const setPhase = useViewportStore((s) => s.setSketchCamPhase)
  // The live camera/size drive the effect deps (they change on a projection swap
  // / panel resize); mutations read fresh via get() to satisfy the immutability
  // lint rule (see CameraRig).
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const get = useThree((s) => s.get)
  const invalidate = useThree((s) => s.invalidate)

  const snapshot = useRef<Snapshot | null>(null)
  // Holds the pose to restore until the camera instance has swapped back to the
  // prior projection (perspective restore is async); then it's applied + cleared.
  const restorePending = useRef<Snapshot | null>(null)
  const wasActive = useRef(false)
  const anim = useRef<{
    active: boolean
    t: number
    mode: 'in' | 'out'
    from: Pose
    to: Pose
    settle: number
  }>({
    active: false,
    t: 0,
    mode: 'in',
    from: { target: new THREE.Vector3(), quat: new THREE.Quaternion(), zoom: 1 },
    to: { target: new THREE.Vector3(), quat: new THREE.Quaternion(), zoom: 1 },
    settle: 0,
  })

  const lockedPose = (): Pose => {
    const p = plane ?? { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }
    const u = new THREE.Vector3(...p.u)
    const v = new THREE.Vector3(...p.v)
    const n = new THREE.Vector3(...p.n)
    const target = new THREE.Vector3(...p.origin)
      .addScaledVector(u, view.cx)
      .addScaledVector(v, view.cy)
    const quat = lookQuat(target.clone().addScaledVector(n, 1), target, v)
    const visibleHeight = view.size * Math.max(1, size.height / size.width)
    return { target, quat, zoom: size.height / Math.max(1, visibleHeight) }
  }

  // The prior 3D framing expressed as an equivalent ortho pose (so the swap into
  // ortho on entry — and back out on exit — shows the same view, seamlessly).
  const reproducePose = (snap: Snapshot): Pose => {
    const quat = lookQuat(snap.position, snap.target, snap.up)
    let zoom = snap.zoom
    if (snap.projection !== 'orthographic') {
      const dist = snap.position.distanceTo(snap.target) || 1
      const visibleHeight = 2 * dist * Math.tan((snap.fov * Math.PI) / 360)
      zoom = size.height / Math.max(1, visibleHeight)
    }
    return { target: snap.target.clone(), quat, zoom }
  }

  const applyRestore = () => {
    const snap = restorePending.current
    if (!snap) return
    const cam = get().camera
    const controls = get().controls as unknown as OrbitLike | null
    // Wait until the camera instance matches the projection we're restoring to.
    if (isOrtho(cam) !== (snap.projection === 'orthographic')) return
    cam.up.copy(snap.up)
    cam.position.copy(snap.position)
    if (isOrtho(cam)) (cam as THREE.OrthographicCamera).zoom = snap.zoom
    ;(cam as THREE.OrthographicCamera).updateProjectionMatrix()
    if (controls) {
      controls.target.copy(snap.target)
      controls.enabled = true
      controls.update()
    }
    invalidate()
    restorePending.current = null
  }

  // Begin the fly-in on entry / fly-out on exit. Keyed on `active` only.
  useEffect(() => {
    if (active && !wasActive.current) {
      const cam = get().camera
      const controls = get().controls as unknown as OrbitLike | null
      const persp = cam as THREE.PerspectiveCamera
      snapshot.current = {
        position: cam.position.clone(),
        target: controls?.target.clone() ?? new THREE.Vector3(),
        up: cam.up.clone(),
        zoom: (cam as THREE.OrthographicCamera).zoom ?? 1,
        fov: persp.isPerspectiveCamera ? persp.fov : FOV,
        projection: usePrefsStore.getState().projection,
      }
      restorePending.current = null
      if (controls) controls.enabled = false
      anim.current = {
        active: true,
        t: 0,
        mode: 'in',
        from: reproducePose(snapshot.current),
        to: lockedPose(),
        settle: 0,
      }
      setPhase('entering')
      invalidate()
    } else if (!active && wasActive.current) {
      const cam = get().camera
      const controls = get().controls as unknown as OrbitLike | null
      const from: Pose = {
        target: controls?.target.clone() ?? new THREE.Vector3(),
        quat: cam.quaternion.clone(),
        zoom: (cam as THREE.OrthographicCamera).zoom ?? 1,
      }
      const to = snapshot.current ? reproducePose(snapshot.current) : from
      anim.current = { active: true, t: 0, mode: 'out', from, to, settle: 0 }
      setPhase('exiting')
      invalidate()
    }
    wasActive.current = active
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Drive the locked camera to match the sketch view once docked. Re-runs on
  // every pan/zoom (`view` is a fresh object) / resize / camera swap, then
  // invalidate()s — no continuous loop, so on-demand rendering is preserved.
  useEffect(() => {
    if (phase !== 'locked' || !active || !plane) return
    const controls = get().controls as unknown as OrbitLike | null
    if (controls) controls.enabled = false
    applyPose(get().camera, controls, lockedPose())
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, active, plane, view, size, camera])

  // Apply a pending restore once the camera instance has swapped back (or
  // immediately, when the prior projection was already orthographic).
  useEffect(() => {
    if (phase === 'idle') applyRestore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, phase])

  // Clip away geometry between the sketch plane and the camera so nothing
  // obstructs the view of the plane. A world-space global clip plane keeps the
  // −n half-space (behind the plane, away from the camera which sits at +n·D);
  // three.js cuts fragments whose signed distance to the plane is negative, so
  // the plane's normal points into the half-space we keep (−n through origin).
  // Active for the whole locked view (incl. the fly-in/out) to match the scrim.
  useEffect(() => {
    const gl = get().gl
    if (plane && (phase === 'entering' || phase === 'locked')) {
      const n = new THREE.Vector3(...plane.n)
      // Offset the coplanar point toward the camera so the sketched face is kept
      // cleanly (avoids the boundary dither — see CLIP_EPSILON).
      const point = new THREE.Vector3(...plane.origin).addScaledVector(n, CLIP_EPSILON)
      const clip = new THREE.Plane().setFromNormalAndCoplanarPoint(n.clone().negate(), point)
      gl.clippingPlanes = [clip]
    } else {
      gl.clippingPlanes = []
    }
    invalidate()
    return () => {
      get().gl.clippingPlanes = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plane])

  // The entry/exit tween. Self-schedules via invalidate() while running.
  useFrame((_, delta) => {
    const a = anim.current
    if (!a.active) {
      // After a tween, keep painting a few frames so the remounted grid and the
      // swapped-back camera converge (on-demand would otherwise leave them stale).
      if (a.settle > 0) {
        a.settle--
        invalidate()
      }
      return
    }
    const cam = get().camera
    // Wait for the perspective→ortho swap before animating, so we don't tween a
    // camera that's about to be replaced (and never paint its default pose).
    if (!isOrtho(cam)) {
      invalidate()
      return
    }
    a.t = Math.min(1, a.t + delta / DURATION)
    const e = easeInOutCubic(a.t)
    const pose: Pose = {
      target: new THREE.Vector3().lerpVectors(a.from.target, a.to.target, e),
      quat: new THREE.Quaternion().slerpQuaternions(a.from.quat, a.to.quat, e),
      zoom: THREE.MathUtils.lerp(a.from.zoom, a.to.zoom, e),
    }
    applyPose(cam, get().controls as unknown as OrbitLike | null, pose)
    if (a.t >= 1) {
      a.active = false
      a.settle = SETTLE_FRAMES
      if (a.mode === 'in') setPhase('locked')
      else {
        restorePending.current = snapshot.current
        setPhase('idle')
        applyRestore() // covers the no-swap case (prior projection was orthographic)
      }
    }
    invalidate()
  })

  return null
}
