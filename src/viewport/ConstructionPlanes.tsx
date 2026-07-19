/**
 * Renders the document's construction planes (datums) as translucent quads.
 * They aren't geometry — they live alongside the CSG tree — so they're drawn
 * here directly from `doc.planes` rather than through NodeView.
 *
 * Clicking a plane selects it (for the property editor / gizmo), except while a
 * sketch plane is being chosen, where the click starts a sketch on that plane.
 * The selected offset/face plane gets a one-axis (normal) translate gizmo whose
 * drag is committed to the plane's offset once, on release (one undo step).
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges, TransformControls } from '@react-three/drei'
import { useCadStore } from '../document/store'
import { resolvedFacePlane, useResolvedStore } from '../document/resolvedStore'
import { useSketchStore } from '../sketch/sketchStore'
import { usePlaneBuilderStore } from './planeBuilderStore'
import { localToWorldMatrix, resolvePlaneDefinition } from '../sketch/plane'

const PLANE_SIZE = 120 // mm; the rendered quad's side (planes are conceptually infinite)
const PLANE_COLOR = '#ab9df2' // construction violet (matches the sketch construction color)
const noRaycast = () => null // disables a mesh's ray hits (so it can't intercept picks)

function PlaneView({ id }: { id: string }) {
  const plane = useCadStore((s) => s.doc.planes[id])
  const selected = useCadStore((s) => s.selectedPlaneId === id)
  const selectPlane = useCadStore((s) => s.selectPlane)
  const choosing = useSketchStore((s) => s.choosing)
  const sketching = useSketchStore((s) => s.active)
  const buildingPlane = usePlaneBuilderStore((s) => s.tool !== null)
  const resolvedDep = useResolvedStore((s) => s.dependents[id])
  const [hovered, setHovered] = useState(false)
  const [meshObj, setMeshObj] = useState<THREE.Mesh | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)

  const offsetGizmo =
    selected &&
    !sketching &&
    !choosing &&
    !buildingPlane &&
    (plane?.definition.kind === 'offset' || plane?.definition.kind === 'face')

  // Commit the drag once, on release: project the gizmo's new position onto the
  // plane normal and fold that delta into the offset. Reads live state so the
  // handler never closes over a stale definition.
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls || !meshObj || !offsetGizmo) return
    const onDragging = (e: { value: boolean }) => {
      if (e.value) return
      const cur = useCadStore.getState().doc.planes[id]
      if (!cur || (cur.definition.kind !== 'offset' && cur.definition.kind !== 'face')) return
      const sp =
        resolvedFacePlane(useResolvedStore.getState().dependents[id], cur.definition) ??
        resolvePlaneDefinition(cur.definition)
      const delta = meshObj.position
        .clone()
        .sub(new THREE.Vector3(...sp.origin))
        .dot(new THREE.Vector3(...sp.n))
      if (Math.abs(delta) > 1e-9) {
        useCadStore
          .getState()
          .setPlaneDefinition(id, { ...cur.definition, distance: cur.definition.distance + delta })
      }
    }
    controls.addEventListener('dragging-changed', onDragging)
    return () => controls.removeEventListener('dragging-changed', onDragging)
  }, [meshObj, offsetGizmo, id])

  if (!plane || !plane.visible) return null

  // While auto-following a moved source face, render (and sketch on) the
  // resolved plane; the stored definition remains the serialized snapshot.
  const sketchPlane =
    resolvedFacePlane(resolvedDep, plane.definition) ?? resolvePlaneDefinition(plane.definition)
  const m = new THREE.Matrix4().fromArray(localToWorldMatrix(sketchPlane))
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  m.decompose(position, quaternion, new THREE.Vector3())

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const sk = useSketchStore.getState()
    if (sk.choosing) sk.chooseConstructionPlane(sketchPlane, plane.name)
    else selectPlane(id)
  }

  return (
    <>
      <mesh
        ref={setMeshObj}
        position={position}
        quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
        // While picking geometry to build a plane, don't let plane quads block
        // clicks meant for the objects behind them.
        {...(buildingPlane ? { raycast: noRaycast } : {})}
      >
        <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
        <meshBasicMaterial
          color={PLANE_COLOR}
          transparent
          opacity={selected ? 0.22 : hovered || choosing ? 0.16 : 0.08}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
        <Edges color={selected ? '#ffffff' : PLANE_COLOR} lineWidth={selected ? 2 : 1} />
      </mesh>

      {offsetGizmo && meshObj && (
        <TransformControls
          ref={controlsRef}
          object={meshObj}
          mode="translate"
          space="local"
          showX={false}
          showY={false}
          showZ
          size={0.6}
        />
      )}
    </>
  )
}

/** Markers for the points picked so far by the three-points plane tool. */
function BuilderMarkers() {
  const points = usePlaneBuilderStore((s) => s.points)
  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={p} raycast={() => null}>
          <sphereGeometry args={[2, 16, 16]} />
          <meshBasicMaterial color="#7bd88f" depthTest={false} transparent />
        </mesh>
      ))}
    </>
  )
}

export function ConstructionPlanes() {
  const planeOrder = useCadStore((s) => s.doc.planeOrder)
  return (
    <>
      {planeOrder.map((id) => (
        <PlaneView key={id} id={id} />
      ))}
      <BuilderMarkers />
    </>
  )
}
