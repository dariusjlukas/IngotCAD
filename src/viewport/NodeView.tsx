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
import { requestFitRecompute } from './fitStore'
import { useDerivedGeometry } from './useDerivedGeometry'
import { coplanarFacePositions } from './faceHighlight'
import { detectCircularEdge } from '../geometry/edges'
import { useMeasureStore } from './measureStore'
import { faceArea } from './measureGeometry'
import { useSectionPlanes, pointIsClipped } from './sectionStore'
import { useEdgeTreatmentStore } from './edgeTreatmentStore'
import { featureEdgesOf, nearestFeatureEdge } from './featureEdgeCache'
import { CircleMarker, EdgeMarker, PICK_COLOR, PolylineMarker, VertexMarker } from './pickMarkers'
import { objectToTransform, rotationDegToRadians } from '../geometry/transform'
import type { NodeId, Transform, Vec3 } from '../document/types'
import { markObjectMenuHandled, openContextMenu, rightButtonDragged } from '../ui/contextMenuStore'
import { objectMenuEntries } from '../ui/objectMenu'

/** What the hovered node is highlighting while picking (planes / measuring). */
type PickHover =
  | { kind: 'face'; positions: Float32Array }
  | { kind: 'vertex'; pos: [number, number, number] }
  | { kind: 'edge'; a: [number, number, number]; b: [number, number, number] }
  | {
      kind: 'circle'
      center: [number, number, number]
      axis: [number, number, number]
      radius: number
      arc: boolean
    }
  | { kind: 'featureEdge'; points: [number, number, number][]; closed: boolean }

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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

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
  const measuring = useMeasureStore((s) => s.active)
  const edgePickTarget = useEdgeTreatmentStore((s) => s.nodeId)
  const clipPlanes = useSectionPlanes()
  const vpTheme = VIEWPORT_THEMES[useResolvedTheme()]
  const smoothShading = usePrefsStore((s) => s.smoothShading)
  const geometry = useDerivedGeometry(id)

  // Picking mode (sketch plane / construction plane / measure / edge pick):
  // hover shows a targeted highlight instead of whole-object hover, and the
  // gizmo is hidden.
  const picking = choosing || planeTool !== null || measuring || edgePickTarget !== null

  const [meshObj, setMeshObj] = useState<THREE.Mesh | null>(null)
  const [hovered, setHovered] = useState(false)

  // Expose this root's mesh so "frame selected" can read its world bounds.
  useEffect(() => {
    registerMesh(id, meshObj)
    requestFitRecompute()
    return () => {
      registerMesh(id, null)
      requestFitRecompute()
    }
  }, [id, meshObj])

  // Keep the build-volume fit check current: geometry rebuilds and committed
  // transform edits both change this root's world bounds.
  useEffect(() => {
    requestFitRecompute()
  }, [geometry, node?.transform])
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
    if (!picking) {
      hoverTriRef.current = -1
      // Clearing a transient highlight on mode exit; nothing to derive from.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPick(null)
    }
  }, [picking])

  if (!node || !node.visible || !geometry) return null

  const rot = rotationDegToRadians(node.transform.rotationDeg)

  /**
   * Measure-tool auto-snap: classify the cursor as vertex / circle / edge /
   * face. Snap thresholds scale with camera distance (clamped for ortho).
   * All outputs are world-space except the face triangle soup (local; the
   * hover overlay applies the node transform, and clicks convert as needed).
   */
  const classifyMeasure = (
    e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>,
  ): PickHover | null => {
    const fi = e.faceIndex ?? -1
    if (fi < 0) return null
    const mw = e.object.matrixWorld
    const local = toLocal(e.point, mw)
    const vertexTol = clamp(0.02 * e.distance, 0.5, 20)
    const edgeTol = clamp(0.012 * e.distance, 0.3, 12)
    const distW = (a: [number, number, number], b: THREE.Vector3) =>
      Math.hypot(a[0] - b.x, a[1] - b.y, a[2] - b.z)

    const lv = nearestTriangleVertex(geometry, fi, local)
    if (lv) {
      const wv = toWorld(lv, mw)
      if (distW(wv, e.point) < vertexTol) return { kind: 'vertex', pos: wv }
    }

    const le = nearestCoplanarBoundaryEdge(geometry, fi, local)
    if (le) {
      const wa = new THREE.Vector3(...le.a).applyMatrix4(mw)
      const wb = new THREE.Vector3(...le.b).applyMatrix4(mw)
      const ab = new THREE.Vector3().subVectors(wb, wa)
      const t = THREE.MathUtils.clamp(
        new THREE.Vector3().subVectors(e.point, wa).dot(ab) / (ab.lengthSq() || 1),
        0,
        1,
      )
      const onSeg = wa.clone().addScaledVector(ab, t)
      if (onSeg.distanceTo(e.point) < edgeTol) {
        // Near a boundary edge: prefer a circular feature if one fits here.
        const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
        const circle = detectCircularEdge(
          { position: posAttr.array as Float32Array, index: geometry.index?.array ?? null },
          fi,
          [local.x, local.y, local.z],
        )
        if (circle) {
          const wc = toWorld(circle.center, mw)
          const onU: Vec3 = [
            circle.center[0] + circle.u[0] * circle.radius,
            circle.center[1] + circle.u[1] * circle.radius,
            circle.center[2] + circle.u[2] * circle.radius,
          ]
          const onV: Vec3 = [
            circle.center[0] + circle.v[0] * circle.radius,
            circle.center[1] + circle.v[1] * circle.radius,
            circle.center[2] + circle.v[2] * circle.radius,
          ]
          const ru = distW(toWorld(onU, mw), new THREE.Vector3(...wc))
          const rv = distW(toWorld(onV, mw), new THREE.Vector3(...wc))
          // Non-uniform scale turns the circle into an ellipse — fall back to
          // the straight segment when the world radii disagree.
          if (Math.abs(ru - rv) <= 0.01 * Math.max(ru, rv)) {
            const wn = new THREE.Vector3(...circle.axis).transformDirection(mw).normalize()
            return {
              kind: 'circle',
              center: wc,
              axis: [wn.x, wn.y, wn.z],
              radius: (ru + rv) / 2,
              arc: circle.arc,
            }
          }
        }
        return { kind: 'edge', a: [wa.x, wa.y, wa.z], b: [wb.x, wb.y, wb.z] }
      }
    }

    const positions = coplanarFacePositions(geometry, fi)
    return positions ? { kind: 'face', positions } : null
  }

  /** The picked face's plane in THIS node's local space (stale detection). */
  const faceRefAt = (e: ThreeEvent<MouseEvent>) => {
    if (!e.face) return undefined
    const localPoint = toLocal(e.point, e.object.matrixWorld)
    const n = e.face.normal // already geometry-local
    return {
      nodeId: id,
      normal: [n.x, n.y, n.z] as Vec3,
      offset: n.x * localPoint.x + n.y * localPoint.y + n.z * localPoint.z,
    }
  }

  /** Edge-treatment picking: the feature edge nearest the cursor, if close. */
  const pickFeatureEdge = (e: ThreeEvent<PointerEvent> | ThreeEvent<MouseEvent>) => {
    const local = toLocal(e.point, e.object.matrixWorld)
    const found = nearestFeatureEdge(featureEdgesOf(geometry), [local.x, local.y, local.z])
    if (!found) return null
    // Tolerance scales with camera distance, converted into local units.
    const sx = new THREE.Vector3().setFromMatrixColumn(e.object.matrixWorld, 0).length() || 1
    const tol = clamp((0.015 * e.distance) / sx, 0.3, 15)
    return found.dist <= tol ? found.edge : null
  }

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (pointIsClipped(e.point)) return // hidden by the section plane
    e.stopPropagation()
    // Edge-treatment picking: a click adds the hovered feature edge.
    const et = useEdgeTreatmentStore.getState()
    if (et.nodeId) {
      if (et.nodeId !== id) return
      const edge = pickFeatureEdge(e)
      if (edge) {
        useCadStore
          .getState()
          .addEdgeEntry(et.nodeId, { kind: et.kind, size: et.size, edge: edge.signature })
      }
      return
    }
    // Measure tool: a click picks an entity instead of selecting.
    const ms = useMeasureStore.getState()
    if (ms.active) {
      const target = classifyMeasure(e)
      if (!target) return
      if (target.kind === 'vertex') ms.pick({ kind: 'vertex', point: target.pos })
      else if (target.kind === 'edge') ms.pick({ kind: 'edge', a: target.a, b: target.b })
      else if (target.kind === 'circle')
        ms.pick({
          kind: 'circle',
          center: target.center,
          axis: target.axis,
          radius: target.radius,
          arc: target.arc,
        })
      else if (target.kind === 'face') {
        const n = e.face
          ? e.face.normal.clone().transformDirection(e.object.matrixWorld).normalize()
          : new THREE.Vector3(0, 0, 1)
        // World-space area: transform the local face soup before measuring.
        const world = new Float32Array(target.positions.length)
        const v = new THREE.Vector3()
        for (let i = 0; i + 2 < target.positions.length; i += 3) {
          v.set(target.positions[i], target.positions[i + 1], target.positions[i + 2]).applyMatrix4(
            e.object.matrixWorld,
          )
          world[i] = v.x
          world[i + 1] = v.y
          world[i + 2] = v.z
        }
        ms.pick({
          kind: 'face',
          point: [e.point.x, e.point.y, e.point.z],
          normal: [n.x, n.y, n.z],
          area: faceArea(world),
        })
      }
      return
    }
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
        pb.pickFace([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z], faceRefAt(e))
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
        sk.chooseFace([e.point.x, e.point.y, e.point.z], [n.x, n.y, n.z], id, faceRefAt(e))
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
    const ms = useMeasureStore.getState()
    const et = useEdgeTreatmentStore.getState()
    if (!useSketchStore.getState().choosing && !tool && !ms.active && !et.nodeId) return
    e.stopPropagation()
    // Edge-treatment hover: light up the feature edge a click would add.
    if (et.nodeId) {
      if (et.nodeId !== id) return
      hoverTriRef.current = -1
      const edge = pointIsClipped(e.point) ? null : pickFeatureEdge(e)
      setPick(
        edge
          ? {
              kind: 'featureEdge',
              points: edge.points.map((p) => toWorld(p, e.object.matrixWorld)),
              closed: edge.kind === 'circle' && Boolean(edge.closed),
            }
          : null,
      )
      return
    }
    // Measure hover: show what a click would pick.
    if (ms.active) {
      hoverTriRef.current = -1
      setPick(pointIsClipped(e.point) ? null : classifyMeasure(e))
      return
    }
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
    if (
      useSketchStore.getState().choosing ||
      usePlaneBuilderStore.getState().tool ||
      useMeasureStore.getState().active ||
      useEdgeTreatmentStore.getState().nodeId
    )
      return
    if (pointIsClipped(e.point)) return
    e.stopPropagation()
    setHovered(true)
  }
  const onPointerOut = () => {
    setHovered(false)
    hoverTriRef.current = -1
    setPick(null)
  }

  const onContextMenu = (e: ThreeEvent<MouseEvent>) => {
    if (
      useSketchStore.getState().choosing ||
      usePlaneBuilderStore.getState().tool ||
      useMeasureStore.getState().active ||
      useEdgeTreatmentStore.getState().nodeId
    )
      return
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
          // Toggling flatShading recompiles the shader, and so does a change in
          // the clipping-plane COUNT; remount via key so the new program is
          // built from scratch. Plane offset changes are uniform updates only.
          key={`${smoothShading ? 'smooth' : 'flat'}${clipPlanes ? '-clip' : ''}`}
          color={node.color}
          flatShading={!smoothShading}
          roughness={0.55}
          metalness={0.1}
          clippingPlanes={clipPlanes ?? null}
          emissive={selected || hovered ? vpTheme.selectionEmissive : '#000000'}
          emissiveIntensity={selected ? 0.4 : hovered ? 0.18 : 0}
        />
        {/* Crisp feature-edge outline on the selected object (hidden while a
            face is being picked, and while sectioned — drei's Edges material
            doesn't take clipping planes, and an outline floating around
            clipped-away geometry reads as a bug). */}
        {selected && !picking && !clipPlanes && (
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
            key={clipPlanes ? 'clip' : 'noclip'}
            color={PICK_COLOR}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            depthWrite={false}
            clippingPlanes={clipPlanes ?? null}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      )}
      {pick?.kind === 'vertex' && <VertexMarker pos={pick.pos} />}
      {pick?.kind === 'edge' && <EdgeMarker a={pick.a} b={pick.b} />}
      {pick?.kind === 'circle' && (
        <CircleMarker center={pick.center} axis={pick.axis} radius={pick.radius} />
      )}
      {pick?.kind === 'featureEdge' && <PolylineMarker points={pick.points} closed={pick.closed} />}

      {isOnlySelected && meshObj && !picking && tool !== 'select' && (
        <TransformControls ref={controlsRef} object={meshObj} mode={tool} />
      )}
    </>
  )
}
