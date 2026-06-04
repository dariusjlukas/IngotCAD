/**
 * Renders the pending extrude/revolve operation as a live, translucent preview
 * inside the 3D viewport, plus a draggable handle to scrub the value:
 *  - extrude: an arrow along the plane normal; drag distance = height.
 *  - revolve: a radial handle in the plane; drag angle = sweep degrees.
 *
 * The preview reuses the engine (a one-node throwaway document) so it's exactly
 * what Confirm will create.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useOperationStore } from './operationStore'
import type { PendingOp } from './operationStore'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { rotationDegToRadians, transformToMatrix4 } from '../geometry/transform'
import { IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode } from '../document/types'

const _scratch = new THREE.Vector3()

/** Keeps its children a constant on-screen size (in px) regardless of zoom/distance. */
function ConstantSize({ position, pixels, children }: { position: [number, number, number]; pixels: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  const camera = useThree((s) => s.camera)
  const viewportHeight = useThree((s) => s.size.height)
  useFrame(() => {
    const g = ref.current
    if (!g) return
    const cam = camera as THREE.PerspectiveCamera
    const dist = cam.position.distanceTo(g.getWorldPosition(_scratch))
    const fov = ((cam.isPerspectiveCamera ? cam.fov : 45) * Math.PI) / 180
    const worldPerPixel = (2 * Math.tan(fov / 2) * dist) / viewportHeight
    g.scale.setScalar(Math.max(1e-4, worldPerPixel * pixels))
  })
  return (
    <group ref={ref} position={position}>
      {children}
    </group>
  )
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
function rayPlaneHit(ray: THREE.Ray, origin: THREE.Vector3, n: THREE.Vector3): THREE.Vector3 | null {
  const denom = ray.direction.dot(n)
  if (Math.abs(denom) < 1e-6) return null
  const t = new THREE.Vector3().subVectors(origin, ray.origin).dot(n) / denom
  if (t < 0) return null
  return ray.origin.clone().addScaledVector(ray.direction, t)
}

function usePreviewGeometry(pending: PendingOp | null): THREE.BufferGeometry | null {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null)
  const ref = useRef<THREE.BufferGeometry | null>(null)
  useEffect(() => {
    if (!pending) {
      ref.current?.dispose()
      ref.current = null
      setGeo(null)
      return
    }
    const params =
      pending.mode === 'extrude'
        ? { type: 'extrusion' as const, profile: pending.profile, height: pending.value, flip: pending.flip }
        : { type: 'revolution' as const, profile: pending.profile, degrees: pending.value, segments: pending.segments }
    const node: CadNode = {
      id: 'preview',
      kind: 'primitive',
      name: 'preview',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: IDENTITY_TRANSFORM,
      params,
    }
    const doc: CadDocument = { schemaVersion: 1, units: 'mm', nodes: { preview: node }, rootIds: ['preview'], assets: {} }
    let cancelled = false
    engine.computeMesh(doc, 'preview').then((raw) => {
      if (cancelled) return
      const g = rawMeshToGeometry(raw)
      ref.current?.dispose()
      ref.current = g
      setGeo(g)
    })
    return () => {
      cancelled = true
    }
  }, [pending])
  useEffect(() => () => ref.current?.dispose(), [])
  return geo
}

export function OperationPreview() {
  const pending = useOperationStore((s) => s.pending)
  const setValue = useOperationStore((s) => s.setValue)
  const setSignedValue = useOperationStore((s) => s.setSignedValue)
  const geo = usePreviewGeometry(pending)
  // The default OrbitControls — disabled during a handle drag.
  const controls = useThree((s) => s.controls) as { enabled?: boolean } | null
  const dragRef = useRef(false)

  if (!pending) return null

  const t = pending.transform
  const rot = rotationDegToRadians(t.rotationDeg)
  const m = transformToMatrix4(t)
  const origin = new THREE.Vector3(t.position[0], t.position[1], t.position[2])
  const nrm = new THREE.Vector3(0, 0, 1).transformDirection(m).normalize()
  const uW = new THREE.Vector3(1, 0, 0).transformDirection(m).normalize()
  const vW = new THREE.Vector3(0, 1, 0).transformDirection(m).normalize()

  const setOrbit = (on: boolean) => {
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

  // --- revolve handle (radial point in the plane) ---
  const radius = Math.max(1, ...pending.profile.flat().map((p) => Math.abs(p[0])))
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
          position={t.position}
          rotation={[rot[0], rot[1], rot[2]]}
          scale={t.scale}
          raycast={() => null}
        >
          <meshStandardMaterial color="#6ea8fe" transparent opacity={0.55} flatShading depthWrite={false} />
        </mesh>
      )}

      {pending.mode === 'extrude' ? (
        <>
          <Line points={[origin.toArray(), extrudeTip.toArray()]} color="#ffd866" lineWidth={2} />
          {/* Cone is a unit size; ConstantSize keeps it the same pixel size. */}
          <ConstantSize position={extrudeTip.toArray()} pixels={36}>
            <mesh
              quaternion={[coneQuat.x, coneQuat.y, coneQuat.z, coneQuat.w]}
              onPointerDown={beginDrag}
              onPointerMove={onExtrudeDrag}
              onPointerUp={endDrag}
            >
              <coneGeometry args={[0.4, 1, 20]} />
              <meshStandardMaterial color="#ffd866" emissive="#a98300" emissiveIntensity={0.5} />
            </mesh>
          </ConstantSize>
        </>
      ) : (
        <>
          <Line points={[origin.toArray(), revHandle.toArray()]} color="#ffd866" lineWidth={2} />
          <ConstantSize position={revHandle.toArray()} pixels={26}>
            <mesh onPointerDown={beginDrag} onPointerMove={onRevolveDrag} onPointerUp={endDrag}>
              <sphereGeometry args={[1, 20, 20]} />
              <meshStandardMaterial color="#ffd866" emissive="#a98300" emissiveIntensity={0.5} />
            </mesh>
          </ConstantSize>
        </>
      )}
    </group>
  )
}
