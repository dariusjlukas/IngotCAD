/**
 * Renders the pending extrude/revolve operation as a live, translucent preview
 * inside the 3D viewport, plus a draggable handle to scrub the value:
 *  - extrude: an arrow along the plane normal; drag distance = height.
 *  - revolve: a radial handle in the plane; drag angle = sweep degrees.
 *
 * The preview reuses the engine on a throwaway document so it's exactly what
 * Confirm will create. When the sketch was drawn on an object and the result
 * folds in (union/subtract), the throwaway doc also includes the source body
 * and the boolean, so the preview shows the real combined result (e.g. a
 * subtract actually shows the cut) — CadScene hides the live source root while
 * this is active.
 */
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useOperationStore } from './operationStore'
import type { PendingOp } from './operationStore'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { rotationDegToRadians, transformToMatrix4 } from '../geometry/transform'
import { IDENTITY_TRANSFORM } from '../document/types'
import type { BooleanOp, CadDocument, CadNode, Vec2 } from '../document/types'
import { rootOf, useCadStore } from '../document/store'

/** Largest bounding-box dimension of the profile (mm). The drag handles are
 *  sized as a fraction of this so they scale with the model in world space
 *  (zooming in/out keeps them proportional to the geometry) rather than being
 *  pinned to a fixed on-screen pixel size. */
function profileExtent(profile: Vec2[][]): number {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of profile) {
    for (const [x, y] of loop) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return Number.isFinite(minX) ? Math.max(maxX - minX, maxY - minY) : 0
}

/** Param along the axis (base + t·dir) of the closest point to the pointer ray. */
function rayAxisParam(ray: THREE.Ray, base: THREE.Vector3, dir: THREE.Vector3): number {
  const w0 = new THREE.Vector3().subVectors(base, ray.origin)
  const a = dir.dot(dir)
  const b = dir.dot(ray.direction)
  const c = ray.direction.dot(ray.direction)
  const d = dir.dot(w0)
  const e = ray.direction.dot(w0)
  const denom = a * c - b * b
  if (Math.abs(denom) < 1e-6) return 0
  return (b * e - c * d) / denom
}

/** Intersect the pointer ray with the plane through `origin` with normal `n`. */
function rayPlaneHit(
  ray: THREE.Ray,
  origin: THREE.Vector3,
  n: THREE.Vector3,
): THREE.Vector3 | null {
  const denom = ray.direction.dot(n)
  if (Math.abs(denom) < 1e-6) return null
  const t = new THREE.Vector3().subVectors(origin, ray.origin).dot(n) / denom
  if (t < 0) return null
  return ray.origin.clone().addScaledVector(ray.direction, t)
}

interface PreviewGeo {
  geo: THREE.BufferGeometry | null
  /** True when `geo` is the combined boolean result, already in world space (so
   *  it renders at identity, not under the sketch-plane transform). */
  combined: boolean
}

function usePreviewGeometry(pending: PendingOp | null): PreviewGeo {
  const [result, setResult] = useState<PreviewGeo>({ geo: null, combined: false })
  const ref = useRef<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (!pending) {
      ref.current?.dispose()
      ref.current = null
      // Clearing the cached preview geometry when the op is dismissed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ geo: null, combined: false })
      return
    }
    const params =
      pending.mode === 'extrude'
        ? {
            type: 'extrusion' as const,
            profile: pending.profile,
            height: pending.value,
            flip: pending.flip,
          }
        : {
            type: 'revolution' as const,
            profile: pending.profile,
            degrees: pending.value,
            segments: pending.segments,
          }

    // Folding into the source object → place the new solid in world space (carry
    // `transform`) and evaluate the boolean. A standalone preview keeps the node
    // at identity and the caller renders it under `transform`.
    const combining = pending.sourceNodeId != null && pending.combine !== 'new'
    const solid: CadNode = {
      id: 'preview-solid',
      kind: 'primitive',
      name: 'preview',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: combining ? pending.transform : IDENTITY_TRANSFORM,
      params,
    }

    let doc: CadDocument
    let evalId: string
    if (combining) {
      // Mirror Confirm: wrap [sourceRoot, newSolid] in the chosen boolean and
      // evaluate that. Live nodes are referenced read-only (never mutated), so
      // there's no deep clone — evaluating the boolean only walks this subtree.
      const live = useCadStore.getState().doc
      const srcRoot = rootOf(live, pending.sourceNodeId as string)
      const op: BooleanOp = pending.combine === 'subtract' ? 'subtract' : 'union'
      const bool: CadNode = {
        id: 'preview-bool',
        kind: 'boolean',
        op,
        name: 'preview',
        childIds: [srcRoot, solid.id],
        color: '#fff',
        visible: true,
        role: 'solid',
        transform: IDENTITY_TRANSFORM,
      }
      doc = {
        ...live,
        nodes: { ...live.nodes, [solid.id]: solid, [bool.id]: bool },
        rootIds: [bool.id],
        featureOrder: [bool.id],
      }
      evalId = bool.id
    } else {
      doc = {
        schemaVersion: 1,
        units: 'mm',
        nodes: { [solid.id]: solid },
        rootIds: [solid.id],
        assets: {},
        featureOrder: [solid.id],
        planes: {},
        planeOrder: [],
        variables: [],
        bindings: {},
      }
      evalId = solid.id
    }

    let cancelled = false
    engine.computeMesh(doc, evalId).then((raw) => {
      if (cancelled) return
      const g = rawMeshToGeometry(raw)
      ref.current?.dispose()
      ref.current = g
      setResult({ geo: g, combined: combining })
    })
    return () => {
      cancelled = true
    }
  }, [pending])
  useEffect(() => () => ref.current?.dispose(), [])
  return result
}

export function OperationPreview() {
  const pending = useOperationStore((s) => s.pending)
  const setValue = useOperationStore((s) => s.setValue)
  const setSignedValue = useOperationStore((s) => s.setSignedValue)
  const { geo, combined } = usePreviewGeometry(pending)
  // Read R3F state fresh inside handlers (s.get) so we can imperatively toggle
  // the default OrbitControls during a handle drag without mutating a value
  // captured at render time.
  const get = useThree((s) => s.get)
  const dragRef = useRef(false)

  if (!pending) return null

  const t = pending.transform
  const rot = rotationDegToRadians(t.rotationDeg)
  const m = transformToMatrix4(t)
  const origin = new THREE.Vector3(t.position[0], t.position[1], t.position[2])
  const nrm = new THREE.Vector3(0, 0, 1).transformDirection(m).normalize()
  const uW = new THREE.Vector3(1, 0, 0).transformDirection(m).normalize()
  const vW = new THREE.Vector3(0, 1, 0).transformDirection(m).normalize()

  // Red preview when the extrude cuts into the source body; blue when it adds.
  const previewColor = pending.combine === 'subtract' ? '#fe6e6e' : '#6ea8fe'

  const setOrbit = (on: boolean) => {
    const controls = get().controls as { enabled?: boolean } | null
    if (controls && 'enabled' in controls) controls.enabled = on
  }
  const beginDrag = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = true
    setOrbit(false)
  }
  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    dragRef.current = false
    setOrbit(true)
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  // --- extrude handle (arrow along the normal, flipped when requested) ---
  const dir = pending.flip ? nrm.clone().negate() : nrm
  const extrudeTip = origin.clone().addScaledVector(dir, pending.value)
  const coneQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  // Arrowhead size in world units: a fraction of the solid's overall size, using
  // max(profile span, height) so it reads well for both flat-wide and thin-tall
  // solids; the floor keeps it from vanishing on a tiny profile.
  const headLen = Math.max(profileExtent(pending.profile), pending.value, 1) * 0.24

  // --- revolve handle (radial point in the plane) ---
  const radius = Math.max(1, ...pending.profile.flat().map((p) => Math.abs(p[0])))
  const handleR = radius * 0.15
  const theta = (pending.value * Math.PI) / 180
  const revHandle = origin
    .clone()
    .addScaledVector(uW, radius * Math.cos(theta))
    .addScaledVector(vW, radius * Math.sin(theta))

  const onExtrudeDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    e.stopPropagation()
    // Project onto the *unflipped* normal → a signed extent. Dragging past 0
    // makes it negative, and setSignedValue auto-flips (storing |value|).
    setSignedValue(rayAxisParam(e.ray, origin, nrm))
  }
  const onRevolveDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return
    e.stopPropagation()
    const hit = rayPlaneHit(e.ray, origin, nrm)
    if (!hit) return
    const local = hit.sub(origin)
    let deg = (Math.atan2(local.dot(vW), local.dot(uW)) * 180) / Math.PI
    deg = ((deg % 360) + 360) % 360
    setValue(deg < 0.5 ? 360 : deg)
  }

  return (
    <group>
      {geo && (
        <mesh
          geometry={geo}
          position={combined ? [0, 0, 0] : t.position}
          rotation={combined ? [0, 0, 0] : [rot[0], rot[1], rot[2]]}
          scale={combined ? 1 : t.scale}
          raycast={() => null}
        >
          <meshStandardMaterial
            color={previewColor}
            transparent
            opacity={0.55}
            flatShading
            depthWrite={false}
          />
        </mesh>
      )}

      {pending.mode === 'extrude' ? (
        <>
          <Line points={[origin.toArray(), extrudeTip.toArray()]} color="#ffd866" lineWidth={2} />
          {/* Unit cone scaled to a world size, so it zooms with the model. */}
          <group position={extrudeTip.toArray()} scale={headLen}>
            <mesh
              quaternion={[coneQuat.x, coneQuat.y, coneQuat.z, coneQuat.w]}
              onPointerDown={beginDrag}
              onPointerMove={onExtrudeDrag}
              onPointerUp={endDrag}
            >
              <coneGeometry args={[0.4, 1, 20]} />
              <meshStandardMaterial color="#ffd866" emissive="#a98300" emissiveIntensity={0.5} />
            </mesh>
          </group>
        </>
      ) : (
        <>
          <Line points={[origin.toArray(), revHandle.toArray()]} color="#ffd866" lineWidth={2} />
          {/* Unit sphere scaled to a world size, so it zooms with the model. */}
          <group position={revHandle.toArray()} scale={handleR}>
            <mesh onPointerDown={beginDrag} onPointerMove={onRevolveDrag} onPointerUp={endDrag}>
              <sphereGeometry args={[1, 20, 20]} />
              <meshStandardMaterial color="#ffd866" emissive="#a98300" emissiveIntensity={0.5} />
            </mesh>
          </group>
        </>
      )}
    </group>
  )
}
