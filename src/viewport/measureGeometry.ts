/**
 * Pure world-space measurement math for the Measure tool. Entities are
 * snapshots taken at pick time (world coordinates), so results stay valid as
 * transient annotations even if the model changes afterwards.
 */
import type { Vec3 } from '../document/types'

export type MeasureEntity =
  | { kind: 'vertex'; point: Vec3 }
  | { kind: 'edge'; a: Vec3; b: Vec3 }
  | { kind: 'circle'; center: Vec3; axis: Vec3; radius: number; arc: boolean }
  | { kind: 'face'; point: Vec3; normal: Vec3; area: number }

export type MeasureResult =
  | { type: 'distance'; value: number; delta: Vec3; from: Vec3; to: Vec3 }
  | { type: 'angle'; valueDeg: number; at: Vec3 }
  | { type: 'info'; lines: string[] }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])

export const fmtMm = (n: number): string => `${n.toFixed(3)} mm`
const fmtPt = (p: Vec3): string => `(${p.map((v) => v.toFixed(2)).join(', ')})`

/** Representative point of an entity for point-based pairing. */
function repPoint(e: MeasureEntity): Vec3 {
  switch (e.kind) {
    case 'vertex':
      return e.point
    case 'edge':
      return [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]
    case 'circle':
      // A circle measures as its center (hole-spacing semantics).
      return e.center
    case 'face':
      return e.point
  }
}

function pointToPlane(p: Vec3, face: Extract<MeasureEntity, { kind: 'face' }>): MeasureResult {
  const d = dot(face.normal, sub(p, face.point))
  const foot = sub(p, scale(face.normal, d))
  return { type: 'distance', value: Math.abs(d), delta: sub(foot, p), from: p, to: foot }
}

function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  let t = l2 === 0 ? 0 : dot(sub(p, a), ab) / l2
  t = Math.max(0, Math.min(1, t))
  return add(a, scale(ab, t))
}

/** Minimum distance between two segments (clamped closest points). */
function segmentSegment(
  p1: Vec3,
  q1: Vec3,
  p2: Vec3,
  q2: Vec3,
): { from: Vec3; to: Vec3; value: number } {
  // Standard clamped closest-point-of-approach (Ericson, Real-Time Collision Detection).
  const d1 = sub(q1, p1)
  const d2 = sub(q2, p2)
  const r = sub(p1, p2)
  const a = dot(d1, d1)
  const e = dot(d2, d2)
  const f = dot(d2, r)
  let s: number
  let t: number
  if (a <= 1e-12 && e <= 1e-12) {
    s = 0
    t = 0
  } else if (a <= 1e-12) {
    s = 0
    t = Math.max(0, Math.min(1, f / e))
  } else {
    const c = dot(d1, r)
    if (e <= 1e-12) {
      t = 0
      s = Math.max(0, Math.min(1, -c / a))
    } else {
      const b = dot(d1, d2)
      const denom = a * e - b * b
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0
      t = (b * s + f) / e
      if (t < 0) {
        t = 0
        s = Math.max(0, Math.min(1, -c / a))
      } else if (t > 1) {
        t = 1
        s = Math.max(0, Math.min(1, (b - c) / a))
      }
    }
  }
  const from = add(p1, scale(d1, s))
  const to = add(p2, scale(d2, t))
  return { from, to, value: len(sub(to, from)) }
}

export function measurePair(a: MeasureEntity, b: MeasureEntity): MeasureResult {
  // Face pairings first (plane distance / angle semantics).
  if (a.kind === 'face' && b.kind === 'face') {
    const align = Math.abs(dot(a.normal, b.normal))
    if (align > 0.9995) return pointToPlane(b.point, a)
    const deg = (Math.acos(Math.max(-1, Math.min(1, align))) * 180) / Math.PI
    return { type: 'angle', valueDeg: deg, at: repPoint(a) }
  }
  if (a.kind === 'face' || b.kind === 'face') {
    const face = (a.kind === 'face' ? a : b) as Extract<MeasureEntity, { kind: 'face' }>
    const other = a.kind === 'face' ? b : a
    return pointToPlane(repPoint(other), face)
  }

  // Edge pairings (skip circles — they pair as centers).
  if (a.kind === 'edge' && b.kind === 'edge') {
    const r = segmentSegment(a.a, a.b, b.a, b.b)
    return { type: 'distance', value: r.value, delta: sub(r.to, r.from), from: r.from, to: r.to }
  }
  if (a.kind === 'edge' || b.kind === 'edge') {
    const edge = (a.kind === 'edge' ? a : b) as Extract<MeasureEntity, { kind: 'edge' }>
    const other = a.kind === 'edge' ? b : a
    if (other.kind !== 'circle') {
      const p = repPoint(other)
      const q = closestOnSegment(p, edge.a, edge.b)
      return { type: 'distance', value: len(sub(q, p)), delta: sub(q, p), from: p, to: q }
    }
  }

  // Everything else: point ↔ point (vertices, circle centers, edge midpoints).
  const p = repPoint(a)
  const q = repPoint(b)
  return { type: 'distance', value: len(sub(q, p)), delta: sub(q, p), from: p, to: q }
}

/** Single-pick readout for the overlay. */
export function entityInfo(e: MeasureEntity): string[] {
  switch (e.kind) {
    case 'vertex':
      return [`Vertex ${fmtPt(e.point)}`]
    case 'edge': {
      const d = sub(e.b, e.a)
      return [`Edge length ${fmtMm(len(d))}`, `Δ ${fmtPt(d)}`]
    }
    case 'circle':
      return [
        `${e.arc ? 'Arc' : 'Circle'} ⌀ ${fmtMm(e.radius * 2)} (R ${e.radius.toFixed(3)})`,
        `Center ${fmtPt(e.center)}`,
      ]
    case 'face':
      return [`Face area ${e.area.toFixed(2)} mm²`, `Normal ${fmtPt(e.normal)}`]
  }
}

export function describeResult(r: MeasureResult): string {
  if (r.type === 'distance')
    return `${fmtMm(r.value)}  ΔX ${r.delta[0].toFixed(2)}  ΔY ${r.delta[1].toFixed(2)}  ΔZ ${r.delta[2].toFixed(2)}`
  if (r.type === 'angle') return `Angle ${r.valueDeg.toFixed(1)}°`
  return r.lines.join(' · ')
}

/** Area of a world-space triangle soup (9 floats per triangle). */
export function faceArea(positions: ArrayLike<number>): number {
  let area = 0
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = Number(positions[i])
    const ay = Number(positions[i + 1])
    const az = Number(positions[i + 2])
    const ux = Number(positions[i + 3]) - ax
    const uy = Number(positions[i + 4]) - ay
    const uz = Number(positions[i + 5]) - az
    const vx = Number(positions[i + 6]) - ax
    const vy = Number(positions[i + 7]) - ay
    const vz = Number(positions[i + 8]) - az
    const cx = uy * vz - uz * vy
    const cy = uz * vx - ux * vz
    const cz = ux * vy - uy * vx
    area += Math.hypot(cx, cy, cz) / 2
  }
  return area
}
