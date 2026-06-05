/**
 * The 3D viewport. Z-up everywhere: the camera up is +Z, the build plate (grid)
 * lies on the XY plane, and 1 unit == 1 mm.
 */
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import { CadScene } from './CadScene'
import { CameraController } from './CameraController'
import { OperationPreview } from '../operation/OperationPreview'
import { useCadStore } from '../document/store'
import { usePrefsStore } from '../preferences/prefsStore'
import { useResolvedTheme } from '../preferences/useResolvedTheme'
import { VIEWPORT_THEMES } from './viewportTheme'

export function Viewport() {
  const clearSelection = useCadStore((s) => s.clearSelection)
  const theme = VIEWPORT_THEMES[useResolvedTheme()]
  const gridEnabled = usePrefsStore((s) => s.gridEnabled)
  const gridSize = usePrefsStore((s) => s.gridSize)

  return (
    <Canvas
      camera={{ position: [140, -180, 140], up: [0, 0, 1], fov: 45, near: 0.1, far: 8000 }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
      onPointerMissed={() => clearSelection()}
    >
      <color attach="background" args={[theme.background]} />
      <hemisphereLight args={[theme.hemiSky, theme.hemiGround, theme.hemiIntensity]} />
      <directionalLight position={[200, -120, 320]} intensity={theme.keyIntensity} />
      <directionalLight position={[-180, 160, 120]} intensity={theme.fillIntensity} />
      <ambientLight intensity={theme.ambientIntensity} />

      {/* Build plate on the XY plane (grid is XZ by default → rotate onto XY). */}
      {gridEnabled && (
        <gridHelper
          args={[gridSize, 40, theme.gridMajor, theme.gridMinor]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      )}

      <CadScene />
      <OperationPreview />

      <CameraController />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={['#ff6188', '#7bd88f', '#6ea8fe']} labelColor="#ffffff" />
      </GizmoHelper>
    </Canvas>
  )
}
