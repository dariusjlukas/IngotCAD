/**
 * Renders one root node and, when it is the sole selection, its transform gizmo.
 *
 * The gizmo is embedded here (rather than in a separate component reaching for
 * the mesh by id) so it always has a direct handle to this node's Object3D.
 *
 * Interaction vs recompute split: while dragging, TransformControls mutates the
 * mesh's matrix imperatively — NO store write, NO Manifold call, so the drag
 * stays at 60fps. On release ('dragging-changed' → false) we write the final
 * transform to the store exactly once, making the whole drag a single undo step.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { useCadStore } from '../document/store'
import { useViewportStore } from './viewportStore'
import { useDerivedGeometry } from './useDerivedGeometry'
import { objectToTransform, rotationDegToRadians } from '../geometry/transform'
import type { NodeId, Transform } from '../document/types'

function transformsEqual(a: Transform, b: Transform): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6
  return (
    a.position.every((v, i) => eq(v, b.position[i])) &&
    a.rotationDeg.every((v, i) => eq(v, b.rotationDeg[i])) &&
    a.scale.every((v, i) => eq(v, b.scale[i]))
  )
}

export function NodeView({ id }: { id: NodeId }) {
  const node = useCadStore((s) => s.doc.nodes[id])
  const selected = useCadStore((s) => s.selectedIds.includes(id))
  const isOnlySelected = useCadStore(
    (s) => s.selectedIds.length === 1 && s.selectedIds[0] === id,
  )
  const select = useCadStore((s) => s.select)
  const toggleSelect = useCadStore((s) => s.toggleSelect)
  const transformNode = useCadStore((s) => s.transformNode)
  const gizmoMode = useViewportStore((s) => s.gizmoMode)
  const requestFocus = useViewportStore((s) => s.requestFocus)
  const geometry = useDerivedGeometry(id)

  const [meshObj, setMeshObj] = useState<THREE.Mesh | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  // Latest committed transform, for the no-op guard below.
  const transformRef = useRef<Transform | undefined>(node?.transform)
  transformRef.current = node?.transform

  useEffect(() => {
    // `isOnlySelected` is a dep so this re-runs when the gizmo mounts and
    // `controlsRef.current` becomes available — not just when the mesh changes.
    const controls = controlsRef.current
    if (!controls || !meshObj || !isOnlySelected) return
    const onDragging = (e: { value: boolean }) => {
      if (e.value) return // drag started — do nothing
      const next = objectToTransform(meshObj)
      if (transformRef.current && !transformsEqual(next, transformRef.current)) {
        transformNode(id, next)
      }
    }
    controls.addEventListener('dragging-changed', onDragging)
    return () => controls.removeEventListener('dragging-changed', onDragging)
  }, [meshObj, id, transformNode, isOnlySelected])

  if (!node || !node.visible || !geometry) return null

  const rot = rotationDegToRadians(node.transform.rotationDeg)

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.shiftKey) toggleSelect(id)
    else select([id])
  }

  const onDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!meshObj) return
    const box = new THREE.Box3().setFromObject(meshObj)
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius
    requestFocus([center.x, center.y, center.z], radius)
  }

  return (
    <>
      <mesh
        ref={setMeshObj}
        geometry={geometry}
        position={node.transform.position}
        rotation={[rot[0], rot[1], rot[2]]}
        scale={node.transform.scale}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        <meshStandardMaterial
          color={node.color}
          flatShading
          roughness={0.55}
          metalness={0.1}
          emissive={selected ? '#1d4ed8' : '#000000'}
          emissiveIntensity={selected ? 0.4 : 0}
        />
      </mesh>
      {isOnlySelected && meshObj && (
        <TransformControls ref={controlsRef} object={meshObj} mode={gizmoMode} />
      )}
    </>
  )
}
