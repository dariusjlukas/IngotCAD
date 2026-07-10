import { describe, expect, it } from 'vitest'
import { collectCoplanarBoundary, detectCircularEdge, matchEdge } from './edges'
import type { FeatureEdge, MeshArrays } from './edges'
import type { Vec3 } from '../document/types'

/** An axis-aligned unit cube as indexed triangles (12 tris, 8 verts). */
function cubeMesh(size = 10): MeshArrays {
  const s = size / 2
  const verts: number[][] = []
  for (const z of [-s, s]) for (const y of [-s, s]) for (const x of [-s, s]) verts.push([x, y, z])
  const position = new Float32Array(verts.flat())
  // prettier-ignore
  const index = new Uint32Array([
    0,2,1, 1,2,3,       // bottom (-z)
    4,5,6, 5,7,6,       // top (+z)
    0,1,4, 1,5,4,       // front (-y)
    2,6,3, 3,6,7,       // back (+y)
    0,4,2, 2,4,6,       // left (-x)
    1,3,5, 3,7,5,       // right (+x)
  ])
  return { position, index }
}

/** A closed cylinder fan mesh: top/bottom caps + side quads, n segments. */
function cylinderMesh(radius = 5, height = 10, n = 32): MeshArrays {
  const pos: number[] = []
  const idx: number[] = []
  // ring vertices: bottom 0..n-1, top n..2n-1, centers 2n (bottom), 2n+1 (top)
  for (const z of [0, height])
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      pos.push(Math.cos(t) * radius, Math.sin(t) * radius, z)
    }
  // fix interleave: first n entries bottom, next n top
  const bottomC = pos.length / 3
  pos.push(0, 0, 0)
  const topC = pos.length / 3
  pos.push(0, 0, height)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    // bottom cap (faces -z): wound to face downward
    idx.push(bottomC, j, i)
    // top cap (faces +z)
    idx.push(topC, n + i, n + j)
    // side quad
    idx.push(i, j, n + i, j, n + j, n + i)
  }
  return { position: new Float32Array(pos), index: new Uint32Array(idx) }
}

describe('collectCoplanarBoundary', () => {
  it('returns the 4 boundary edges of a cube face (no interior diagonal)', () => {
    const mesh = cubeMesh(10)
    // triangle 0 lies on the bottom face
    const b = collectCoplanarBoundary(mesh, 0)!
    expect(b.edges).toHaveLength(4)
    expect(Math.abs(b.plane.normal[2])).toBeCloseTo(1)
  })

  it('returns the rim of a cylinder cap', () => {
    const mesh = cylinderMesh(5, 10, 32)
    // first triangle is a bottom-cap fan triangle
    const b = collectCoplanarBoundary(mesh, 0)!
    expect(b.edges).toHaveLength(32)
  })
})

describe('detectCircularEdge', () => {
  it('fits a full circle on a cylinder cap rim', () => {
    const mesh = cylinderMesh(5, 10, 32)
    const fit = detectCircularEdge(mesh, 0, [5, 0, 0])!
    expect(fit).not.toBeNull()
    expect(fit.radius).toBeCloseTo(5, 1)
    expect(fit.center[0]).toBeCloseTo(0, 3)
    expect(fit.center[1]).toBeCloseTo(0, 3)
    expect(fit.center[2]).toBeCloseTo(0, 3)
    expect(Math.abs(fit.axis[2])).toBeCloseTo(1)
    expect(fit.arc).toBe(false)
  })

  it('rejects a square (cube face) — corners are not a circle', () => {
    const mesh = cubeMesh(10)
    expect(detectCircularEdge(mesh, 0, [5, 0, -5])).toBeNull()
  })

  it('rejects when the loop has too few vertices', () => {
    const mesh = cylinderMesh(5, 10, 4) // a square prism
    expect(detectCircularEdge(mesh, 0, [5, 0, 0])).toBeNull()
  })
})

describe('matchEdge loose fallback', () => {
  const boxNormals: [Vec3, Vec3] = [
    [1, 0, 0],
    [0, 1, 0],
  ]

  function lineEdge(a: Vec3, b: Vec3, normals: [Vec3, Vec3] = boxNormals): FeatureEdge {
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const length = Math.hypot(d[0], d[1], d[2])
    const dir: Vec3 = [d[0] / length, d[1] / length, d[2] / length]
    const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
    return {
      kind: 'line',
      a,
      b,
      points: [a, b],
      normals,
      convex: true,
      signature: { kind: 'line', point: mid, dir, length, normals },
    }
  }

  function circleEdge(center: Vec3, radius: number, axis: Vec3 = [0, 0, 1]): FeatureEdge {
    const normals: [Vec3, Vec3] = [axis, [1, 0, 0]]
    return {
      kind: 'circle',
      center,
      axis,
      radius,
      closed: true,
      points: [[center[0] + radius, center[1], center[2]]],
      normals,
      convex: true,
      signature: {
        kind: 'circle',
        point: center,
        dir: axis,
        length: 2 * Math.PI * radius,
        radius,
        normals,
      },
    }
  }

  // The vertical +X+Y edge of a 20mm box centered at the origin.
  const sig = lineEdge([10, 10, -10], [10, 10, 10]).signature

  it('does not rebind a line to a parallel edge on another object', () => {
    // Box A (the picked one) was deleted; box B, 50mm away, has a parallel
    // edge with the same direction and normals. Never silently rebind.
    const other = lineEdge([60, 10, -10], [60, 10, 10])
    expect(matchEdge(sig, [other])).toBeNull()
  })

  it('still rebinds a line after a small param edit', () => {
    // The picked edge drifted 3mm sideways (e.g. the box was widened): the
    // exact stage misses (perpendicular offset > MATCH_LINE_DIST), the loose
    // stage must catch it.
    const shifted = lineEdge([13, 10, -10], [13, 10, 10])
    const match = matchEdge(sig, [shifted])
    expect(match).not.toBeNull()
    expect(match!.exact).toBe(false)
  })

  it('does not rebind a circle to a coaxial circle of a different size elsewhere', () => {
    const sigC = circleEdge([0, 0, 10], 5).signature
    const other = circleEdge([0, 0, -40], 20)
    expect(matchEdge(sigC, [other])).toBeNull()
  })

  it('still rebinds a circle after a small param edit', () => {
    // Rim moved 2mm axially and grew 0.5mm in radius (a height/radius tweak):
    // outside the exact-stage tolerance, inside the loose gates.
    const sigC = circleEdge([0, 0, 10], 5).signature
    const tweaked = circleEdge([0, 0, 12], 5.5)
    const match = matchEdge(sigC, [tweaked])
    expect(match).not.toBeNull()
    expect(match!.exact).toBe(false)
  })
})
