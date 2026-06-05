/**
 * The 3D viewport. Z-up everywhere: the camera up is +Z, the build plate (grid)
 * lies on the XY plane, and 1 unit == 1 mm.
 */
import { useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHouse } from '@fortawesome/free-solid-svg-icons'
import { CadScene } from './CadScene'
import { CameraController } from './CameraController'
import { OperationPreview } from '../operation/OperationPreview'
import { useCadStore } from '../document/store'
import { usePrefsStore } from '../preferences/prefsStore'
import { useResolvedTheme } from '../preferences/useResolvedTheme'
import { VIEWPORT_THEMES } from './viewportTheme'
import { DEFAULT_CAMERA_POSITION, useViewportStore } from './viewportStore'

/**
 * An endless build-plate grid. Rather than a giant mesh, this is a modestly
 * sized plane that rides along under the camera (drei's `followCamera`) while the
 * grid pattern stays locked to world coordinates — so it always looks infinite
 * but you can never pan off its edge. The plane is large enough that the
 * distance-fade always finishes before the geometric boundary, and the fade
 * radius scales with the zoom level so it reads as infinite at any distance with
 * no manual tuning. 10mm minor cells, 100mm major sections.
 *
 * The XY-plane (Z-up) orientation comes from the same rotation the old
 * gridHelper used: drei's <Grid> builds its plane on the XZ plane in-shader, and
 * rotating +90° about X lands it on Z=0.
 */
const GRID_EXTENT = 20000 // mm; plane size — comfortably larger than FADE_MAX
const FADE_ZOOM_FACTOR = 3 // fade radius ≈ this × the camera's orbit distance
const FADE_MIN = 40 // mm; keep some grid visible when zoomed in very close
const FADE_MAX = 6000 // mm; stay well inside the plane and the camera far clip

function BuildPlateGrid({ cellColor, sectionColor }: { cellColor: string; sectionColor: string }) {
  const ref = useRef<THREE.Mesh>(null)

  // Mutating the fade uniform per frame (not store/state) is the sanctioned
  // imperative path; scaling it with the orbit distance keeps the infinite look
  // consistent from a tight zoom to fully zoomed out.
  useFrame((state) => {
    const mesh = ref.current
    if (!mesh) return
    const mat = mesh.material as unknown as THREE.ShaderMaterial
    const fade = mat.uniforms?.fadeDistance
    if (!fade) return
    const controls = state.controls as unknown as { target?: THREE.Vector3 } | null
    const dist = controls?.target
      ? state.camera.position.distanceTo(controls.target)
      : state.camera.position.length()
    fade.value = Math.min(Math.max(dist * FADE_ZOOM_FACTOR, FADE_MIN), FADE_MAX)
  })

  return (
    <Grid
      ref={ref}
      args={[GRID_EXTENT, GRID_EXTENT]}
      rotation={[Math.PI / 2, 0, 0]}
      followCamera
      cellSize={10}
      cellThickness={1}
      cellColor={cellColor}
      sectionSize={100}
      sectionThickness={1.5}
      sectionColor={sectionColor}
      fadeDistance={800}
      fadeStrength={1}
      side={THREE.DoubleSide}
    />
  )
}

export function Viewport() {
  const clearSelection = useCadStore((s) => s.clearSelection)
  const resetView = useViewportStore((s) => s.resetView)
  const theme = VIEWPORT_THEMES[useResolvedTheme()]
  const gridEnabled = usePrefsStore((s) => s.gridEnabled)

  return (
    <div className="relative h-full w-full">
      <Canvas
        // On-demand rendering: only paint frames when something actually changes
        // (camera move, geometry edit, hover, theme) rather than a continuous
        // 60fps loop, so an idle viewport costs no GPU/CPU. OrbitControls (incl.
        // damping) and the gizmo self-schedule via invalidate(); CameraController's
        // fly-to animation invalidates itself while active.
        frameloop="demand"
        camera={{ position: DEFAULT_CAMERA_POSITION, up: [0, 0, 1], fov: 45, near: 0.1, far: 8000 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
        onPointerMissed={() => clearSelection()}
      >
        <color attach="background" args={[theme.background]} />
        <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
        <directionalLight position={[200, -120, 320]} intensity={theme.keyIntensity} />
        <directionalLight position={[-180, 160, 120]} intensity={theme.fillIntensity} />
        <ambientLight intensity={theme.ambientIntensity} />

        {gridEnabled && (
          <BuildPlateGrid cellColor={theme.gridMinor} sectionColor={theme.gridMajor} />
        )}

        <CadScene />
        <OperationPreview />

        <CameraController />
        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
          <GizmoViewport axisColors={['#ff6188', '#7bd88f', '#6ea8fe']} labelColor="#ffffff" />
        </GizmoHelper>
      </Canvas>

      <button
        type="button"
        onClick={resetView}
        title="Reset view"
        aria-label="Reset view"
        className="absolute top-3 right-3 z-10 rounded-md border border-line bg-panel p-2 text-fg-muted shadow-sm transition-colors hover:bg-elevated hover:text-fg"
      >
        <FontAwesomeIcon icon={faHouse} className="h-4 w-4" />
      </button>
    </div>
  )
}
