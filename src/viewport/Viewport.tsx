/**
 * The 3D viewport. Z-up everywhere: the camera up is +Z, the build plate (grid)
 * lies on the XY plane, and 1 unit == 1 mm.
 */
import { Canvas } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, OrbitControls } from '@react-three/drei'
import { CadScene } from './CadScene'
import { CameraController } from './CameraController'
import { useCadStore } from '../document/store'

export function Viewport() {
  const clearSelection = useCadStore((s) => s.clearSelection)

  return (
    <Canvas
      camera={{ position: [140, -180, 140], up: [0, 0, 1], fov: 45, near: 0.1, far: 8000 }}
      gl={{ antialias: true }}
      dpr={[1, 2]}
      onPointerMissed={() => clearSelection()}
    >
      <color attach="background" args={['#15161b']} />
      <hemisphereLight args={['#ffffff', '#3a3f4b', 0.65]} />
      <directionalLight position={[200, -120, 320]} intensity={1.1} />
      <directionalLight position={[-180, 160, 120]} intensity={0.35} />
      <ambientLight intensity={0.25} />

      {/* Build plate on the XY plane (grid is XZ by default → rotate onto XY). */}
      <gridHelper args={[400, 40, '#46506b', '#262a33']} rotation={[Math.PI / 2, 0, 0]} />
      <axesHelper args={[40]} />

      <CadScene />

      <CameraController />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[72, 72]}>
        <GizmoViewport axisColors={['#ff6188', '#7bd88f', '#6ea8fe']} labelColor="#ffffff" />
      </GizmoHelper>
    </Canvas>
  )
}
