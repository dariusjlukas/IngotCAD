/**
 * Shared hover/pick marker meshes for viewport picking modes (plane builder,
 * measure). All world-space, non-raycastable, drawn through the surface.
 */
import * as THREE from 'three'
import { useMemo } from 'react'

export const PICK_COLOR = '#7bd88f'

export function VertexMarker({
  pos,
  color = PICK_COLOR,
}: {
  pos: [number, number, number]
  color?: string
}) {
  return (
    <mesh position={pos} raycast={() => null}>
      <sphereGeometry args={[2, 16, 16]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  )
}

/** A thin highlight along an edge (a cylinder so it reads at any zoom and
 *  shows through the surface). */
export function EdgeMarker({
  a,
  b,
  color = PICK_COLOR,
  radius = 0.8,
}: {
  a: [number, number, number]
  b: [number, number, number]
  color?: string
  radius?: number
}) {
  const A = new THREE.Vector3(...a)
  const B = new THREE.Vector3(...b)
  const dir = new THREE.Vector3().subVectors(B, A)
  const len = dir.length() || 1
  const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  return (
    <mesh position={[mid.x, mid.y, mid.z]} quaternion={[q.x, q.y, q.z, q.w]} raycast={() => null}>
      <cylinderGeometry args={[radius, radius, len, 8]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  )
}

/** A polyline highlight along a detected feature edge (chain of segments). */
export function PolylineMarker({
  points,
  color = PICK_COLOR,
  closed = false,
}: {
  points: [number, number, number][]
  color?: string
  closed?: boolean
}) {
  const n = points.length
  if (n < 2) return null
  const count = closed ? n : n - 1
  return (
    <group>
      {Array.from({ length: count }, (_, i) => (
        <EdgeMarker key={i} a={points[i]} b={points[(i + 1) % n]} color={color} radius={0.6} />
      ))}
    </group>
  )
}

/** A ring marker on a detected circular edge (torus oriented along the axis). */
export function CircleMarker({
  center,
  axis,
  radius,
  color = PICK_COLOR,
}: {
  center: [number, number, number]
  axis: [number, number, number]
  radius: number
  color?: string
}) {
  const q = useMemo(() => {
    const n = new THREE.Vector3(...axis).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
  }, [axis])
  return (
    <mesh position={center} quaternion={[q.x, q.y, q.z, q.w]} raycast={() => null}>
      <torusGeometry args={[radius, 0.6, 8, 64]} />
      <meshBasicMaterial color={color} depthTest={false} transparent />
    </mesh>
  )
}
