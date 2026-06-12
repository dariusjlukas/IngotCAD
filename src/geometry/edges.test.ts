import { describe, expect, it } from 'vitest'
import { collectCoplanarBoundary, detectCircularEdge } from './edges'
import type { MeshArrays } from './edges'

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
