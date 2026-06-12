/**
 * In-canvas geometry for the Measure tool: markers for picked entities and a
 * dimension line per completed measurement. Pure display — nothing here
 * raycasts, and everything draws through the model (depthTest off).
 */
import * as THREE from 'three'
import { Line } from '@react-three/drei'
import { useMeasureStore } from './measureStore'
import type { MeasureEntity, MeasureResult } from './measureGeometry'
import { EdgeMarker, VertexMarker } from './pickMarkers'

const MEASURE_COLOR = '#ffd866'
const PENDING_COLOR = '#7bd88f'

function circlePoints(
  center: [number, number, number],
  axis: [number, number, number],
  radius: number,
): [number, number, number][] {
  const n = new THREE.Vector3(...axis).normalize()
  const ref = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
  const u = new THREE.Vector3().crossVectors(n, ref).normalize()
  const v = new THREE.Vector3().crossVectors(n, u)
  const c = new THREE.Vector3(...center)
  const pts: [number, number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2
    const p = c
      .clone()
      .addScaledVector(u, Math.cos(t) * radius)
      .addScaledVector(v, Math.sin(t) * radius)
    pts.push([p.x, p.y, p.z])
  }
  return pts
}

function EntityMarker({ e, color }: { e: MeasureEntity; color: string }) {
  switch (e.kind) {
    case 'vertex':
      return <VertexMarker pos={e.point} color={color} />
    case 'edge':
      return <EdgeMarker a={e.a} b={e.b} color={color} radius={0.5} />
    case 'circle':
      return (
        <Line
          points={circlePoints(e.center, e.axis, e.radius)}
          color={color}
          lineWidth={2}
          depthTest={false}
        />
      )
    case 'face':
      return <VertexMarker pos={e.point} color={color} />
  }
}

function ResultLine({ r }: { r: MeasureResult }) {
  if (r.type !== 'distance' || r.value < 1e-6) return null
  return (
    <>
      <Line points={[r.from, r.to]} color={MEASURE_COLOR} lineWidth={2} depthTest={false} />
      <VertexMarker pos={r.from} color={MEASURE_COLOR} />
      <VertexMarker pos={r.to} color={MEASURE_COLOR} />
    </>
  )
}

export function MeasureVisuals() {
  const active = useMeasureStore((s) => s.active)
  const pending = useMeasureStore((s) => s.pending)
  const measurements = useMeasureStore((s) => s.measurements)

  if (!active && measurements.length === 0) return null
  return (
    <>
      {pending && <EntityMarker e={pending} color={PENDING_COLOR} />}
      {measurements.map((m) => (
        <group key={m.id}>
          <EntityMarker e={m.a} color={MEASURE_COLOR} />
          <EntityMarker e={m.b} color={MEASURE_COLOR} />
          <ResultLine r={m.result} />
        </group>
      ))}
    </>
  )
}
