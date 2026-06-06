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
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Edges, TransformControls } from '@react-three/drei'
import { useCadStore } from '../document/store'
import { useViewportStore } from './viewportStore'
import { usePlaneBuilderStore } from './planeBuilderStore'
import { nearestCoplanarBoundaryEdge, nearestTriangleVertex } from './edgePick'
import { useSketchStore } from '../sketch/sketchStore'
import { useResolvedTheme } from '../preferences/useResolvedTheme'
import { usePrefsStore } from '../preferences/prefsStore'
import { VIEWPORT_THEMES } from './viewportTheme'
import { registerMesh } from './meshRegistry'
import { useDerivedGeometry } from './useDerivedGeometry'
import { coplanarFacePositions } from './faceHighlight'
import { objectToTransform, rotationDegToRadians } from '../geometry/transform'
import type { NodeId, Transform, Vec3 } from '../document/types'
import { markObjectMenuHandled, openContextMenu, rightButtonDragged } from '../ui/contextMenuStore'
import { objectMenuEntries } from '../ui/objectMenu'

const PICK_COLOR = '#7bd88f'

/** What the hovered node is highlighting while a plane is being picked. */
type PickHover =
  | { kind: 'face'; positions: Float32Array }
  | { kind: 'vertex'; pos: [number, number, number] }
  | { kind: 'edge'; a: [number, number, number]; b: [number, number, number] }

function transformsEqual(a: Transform, b: Transform): boolean {
  const eq = (x: number, y: number) => Math.abs(x - y) < 1e-6
  return (
    a.position.every((v, i) => eq(v, b.position[i])) &&
    a.rotationDeg.every((v, i) => eq(v, b.rotationDeg[i])) &&
    a.scale.every((v, i) => eq(v, b.scale[i]))
  )
}

const toLocal = (worldPoint: THREE.Vector3, matrixWorld: THREE.Matrix4): THREE.Vector3 =>
  worldPoint.clone().applyMatrix4(new THREE.Matrix4().copy(matrixWorld).invert())

const toWorld = (local: Vec3, matrixWorld: THREE.Matrix4): [number, number, number] => {
  const w = new THREE.Vector3(...local).applyMatrix4(matrixWorld)
  return [w.x, w.y, w.z]
}

/** A small marker on the corner the 3-point tool would pick. */
function VertexMarker({ pos }: { pos: [number, number, number] }) {
  return (
    <mesh position={pos} raycast={() => null}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshBasicMaterial color={PICK_COLOR} depthTest={false} transparent />
    </mesh>
  )
}

/** A thin highlight along the edge the angle tool would pick (a cylinder so it
 *  reads at any zoom and shows through the surface). */
function EdgeMarker({ a, b }: { a: [number, number, number]; b: [number, number, number] }) {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const dir = new THREE.Vector3().subVectors(B, A)
  const len = dir.length() || 1
  const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return (
    <mesh position={[mid.x, mid.y, mid.z]} quaternion={[q.x, q.y, q.z, q.w]} raycast={() => null}>
      <cylinderGeometry args={[0.8, 0.8, len, 8]} />
      <meshBasicMaterial color={PICK_COLOR} depthTest={false} transparent />
    </mesh>
  )
}

export function NodeView({ id }: { id: NodeId }) {
  const node = useCadStore((s) => s.doc.nodes[id])
  const selected = useCadStore((s) => s.selectedIds.includes(id))
  const isOnlySelected = useCadStore((s) => s.selectedIds.length === 1 && s.selectedIds[0] === id)
  const select = useCadStore((s) => s.select)
  const toggleSelect = useCadStore((s) => s.toggleSelect)
  const setNodeTransform = useCadStore((s) => s.setNodeTransform)
  const tool = useViewportStore((s) => s.tool)
  const requestFocus = useViewportStore((s) => s.requestFocus)
  const choosing = useSketchStore((s) => s.choosing)
  const planeTool = usePlaneBuilderStore((s) => s.tool)
  const vpTheme = VIEWPORT_THEMES[useResolvedTheme()]
  const smoothShading = usePrefsStore((s) => s.smoothShading)
  const geometry = useDerivedGeometry(id)

  // Picking a face for a sketch plane OR for a construction plane: in both, hover
  // highlights the coplanar face (not the whole object) and the gizmo is hidden.
  const facePicking = choosing || planeTool !== null

  const [meshObj, setMeshObj] = useState<THREE.Mesh | null>(null)
  const [hovered, setHovered] = useState(false)

  // Expose this root's mesh so "frame selected" can read its world bounds.
  useEffect(() => {
    registerMesh(id, meshObj)
    return () => registerMesh(id, null)
  }, [id, meshObj])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null)
  // Latest committed transform, for the no-op guard below.
  const transformRef = useRef<Transform | undefined>(node?.transform)
  useEffect(() => {
    transformRef.current = node?.transform
  })

  // What the cursor is highlighting while a plane is being picked: a coplanar
  // face, a corner (3-point tool), or a feature edge (angle tool). `hoverTriRef`
  // avoids recomputing the coplanar face when the hovered triangle is unchanged.
  const [pick, setPick] = useState<PickHover | null>(null)
  const hoverTriRef = useRef<number>(-1)

  useEffect(() => {
    // `isOnlySelected`/`tool` are deps so this re-runs when the gizmo mounts and
    // `controlsRef.current` becomes available — not just when the mesh changes.
    const controls = controlsRef.current
    if (!controls || !meshObj || !isOnlySelected) return
    const onDragging = (e: { value: boolean }) => {
      if (e.value) return // drag started — do nothing
      const next = objectToTransform(meshObj)
      if (transformRef.current && !transformsEqual(next, transformRef.current)) {
        setNodeTransform(id, next)
      }
    }
    controls.addEventListener('dragging-changed', onDragging)
    return () => controls.removeEventListener('dragging-changed', onDragging)
  }, [meshObj, id, setNodeTransform, isOnlySelected, tool])

  const hoverGeometry = useMemo(() => {
    if (pick?.kind !== 'face') return null
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pick.positions, 3))
    return g
  }, [pick])
  useEffect(() => () => hoverGeometry?.dispose(), [hoverGeometry])

  // Clear the hover highlight when we leave any picking mode.
  useEffect(() => {
    if (!facePicking) {
      hoverTriRef.current = -1
      // Clearing a transient highlight on mode exit; nothing to derive from.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPick(null)
    }
  }, [facePicking])

  if (!node || !node.visible || !geometry) return null

  const rot = rotationDegToRadians(node.transform.rotationDeg)

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // Building a construction plane by picking: a click feeds the active tool.
    const pb = usePlaneBuilderStore.getState()
    if (pb.tool) {
      const worldNormal = () =>
        e.face
          ? e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize()
          : new THREE.Vector3(0, 0, 1)
      if (pb.tool === 'threePoints') {
        const lv =
          e.faceIndex != null
            ? nearestTriangleVertex(geometry, e.faceIndex, toLocal(e.point, e.object.matrixWorld))
            : null
        pb.pickPoint(lv ? toWorld(lv, e.object.matrixWorld) : [e.point.x, e.point.y, e.point.z])
      } else if (pb.tool === 'face') {
        const n = worldNormal()
        pb.pickFace([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z])
      } else if (pb.tool === 'edgeAngle' && e.faceIndex != null) {
        const inv = new THREE.Matrix4().copy(e.object.matrixWorld).invert()
        const localPoint = e.point.clone().applyMatrix4(inv)
        const edge = nearestCoplanarBoundaryEdge(geometry, e.faceIndex, localPoint)
        if (edge) {
          const wa = new THREE.Vector3(...edge.a).applyMatrix4(e.object.matrixWorld)
          const wb = new THREE.Vector3(...edge.b).applyMatrix4(e.object.matrixWorld)
          const axis = new THREE.Vector3().subVectors(wb, wa)
          if (axis.lengthSq() > 1e-12) {
            axis.normalize()
            const n = worldNormal()
            pb.pickEdge([wa.x, wa.y, wa.z], [axis.x, axis.y, axis.z], [n.x, n.y, n.z])
          }
        }
      }
      return
    }
    // While choosing a sketch plane, a click picks this face instead of selecting.
    const sk = useSketchStore.getState()
    if (sk.choosing) {
      if (e.face) {
        const n = e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize()
        sk.chooseFace([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z], id)
      }
      return
    }
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

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const tool = usePlaneBuilderStore.getState().tool
    if (!useSketchStore.getState().choosing && !tool) return
    e.stopPropagation()
    const fi = e.faceIndex ?? -1
    const mw = e.object.matrixWorld

    // 3-point tool: snap to the nearest corner of the hovered triangle.
    if (tool === 'threePoints') {
      hoverTriRef.current = -1
      const lv = fi >= 0 ? nearestTriangleVertex(geometry, fi, toLocal(e.point, mw)) : null
      setPick(lv ? { kind: 'vertex', pos: toWorld(lv, mw) } : null)
      return
    }
    // Angle tool: highlight the nearest actual feature edge under the cursor.
    if (tool === 'edgeAngle') {
      hoverTriRef.current = -1
      const le = fi >= 0 ? nearestCoplanarBoundaryEdge(geometry, fi, toLocal(e.point, mw)) : null
      setPick(le ? { kind: 'edge', a: toWorld(le.a, mw), b: toWorld(le.b, mw) } : null)
      return
    }
    // Face tool / sketch choosing: highlight the whole coplanar face.
    if (fi === hoverTriRef.current) return
    hoverTriRef.current = fi
    const positions = fi >= 0 ? coplanarFacePositions(geometry, fi) : null
    setPick(positions ? { kind: 'face', positions } : null)
  }
  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (useSketchStore.getState().choosing || usePlaneBuilderStore.getState().tool) return
    e.stopPropagation()
    setHovered(true)
  }
  const onPointerOut = () => {
    setHovered(false)
    hoverTriRef.current = -1
    setPick(null)
  }

  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    if (useSketchStore.getState().choosing || usePlaneBuilderStore.getState().tool) return
    const native = e.nativeEvent
    if (rightButtonDragged(native.clientX, native.clientY)) return // was an orbit pan, not a click
    e.stopPropagation()
    native.preventDefault()
    markObjectMenuHandled()
    const store = useCadStore.getState()
    const ids = store.selectedIds.includes(id) ? store.selectedIds : [id]
    if (!store.selectedIds.includes(id)) store.select([id])
    openContextMenu(native.clientX, native.clientY, objectMenuEntries(ids))
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
        onContextMenu={onContextMenu}
        onPointerOver={onPointerOver}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
      >
        <meshStandardMaterial
          // Toggling flatShading recompiles the shader; remount via key so the
          // new program is built from scratch rather than relying on needsUpdate.
          key={smoothShading ? 'smooth' : 'flat'}
          color={node.color}
          flatShading={!smoothShading}
          roughness={0.55}
          metalness={0.1}
          emissive={selected || hovered ? vpTheme.selectionEmissive : '#000000'}
          emissiveIntensity={selected ? 0.4 : hovered ? 0.18 : 0}
        />
        {/* Crisp feature-edge outline on the selected object (hidden while a
            face is being picked, where the green face highlight leads). */}
        {selected && !facePicking && (
          <Edges threshold={20} color={vpTheme.selectionOutline} lineWidth={2.5} renderOrder={1} />
        )}
      </mesh>

      {/* Hover highlight while picking a plane: the coplanar face (face tool /
          sketch choosing), the nearest corner (3-point), or a feature edge (angle). */}
      {pick?.kind === 'face' && hoverGeometry && (
        <mesh
          geometry={hoverGeometry}
          position={node.transform.position}
          rotation={[rot[0], rot[1], rot[2]]}
          scale={node.transform.scale}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={PICK_COLOR}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      )}
      {pick?.kind === 'vertex' && <VertexMarker pos={pick.pos} />}
      {pick?.kind === 'edge' && <EdgeMarker a={pick.a} b={pick.b} />}

      {isOnlySelected && meshObj && !facePicking && tool !== 'select' && (
        <TransformControls ref={controlsRef} object={meshObj} mode={tool} />
      )}
    </>
  )
}
