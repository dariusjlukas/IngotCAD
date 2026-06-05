import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { computeExportRaw, measureSolid } from './evaluate'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode, PrimitiveParams, Vec2 } from '../document/types'

let M: ManifoldToplevel

beforeAll(async () => {
  M = await Module()
  M.setup()
})

function prim(
  id: string,
  params: PrimitiveParams,
  pos: [number, number, number] = [0, 0, 0],
): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM, position: pos },
    params,
  }
}

function docOf(nodes: CadNode[], rootIds: string[]): CadDocument {
  const d = createEmptyDocument()
  for (const n of nodes) d.nodes[n.id] = n
  d.rootIds = rootIds
  return d
}

describe('Manifold evaluation pipeline', () => {
  it('builds a watertight 20mm box (volume 8000, 12 triangles)', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])

    const { volume, triangles } = measureSolid(M, doc, 'b')
    expect(volume).toBeCloseTo(8000, 1)
    expect(triangles).toBe(12)

    const raw = computeExportRaw(M, doc, ['b'])
    expect(raw.index.length).toBe(36) // 12 triangles * 3
    expect(raw.index.length % 3).toBe(0)
    // Centered at the origin: every coordinate within +/-10.
    for (const v of raw.position) expect(Math.abs(v)).toBeLessThanOrEqual(10.0001)
  })

  it('subtracts a cylinder from a box, reducing volume', () => {
    const doc = docOf(
      [
        {
          id: 'diff',
          kind: 'boolean',
          op: 'subtract',
          name: 'diff',
          color: '#fff',
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
          childIds: ['box', 'bore'],
        },
        prim('box', { type: 'box', size: [20, 20, 20] }),
        prim('bore', { type: 'cylinder', height: 30, radiusBottom: 5, radiusTop: 5, segments: 64 }),
      ],
      ['diff'],
    )

    const { volume } = measureSolid(M, doc, 'diff')
    // 8000 - π·5²·20 ≈ 6429
    expect(volume).toBeLessThan(7000)
    expect(volume).toBeGreaterThan(6000)
  })

  it('extrudes a sketched profile into a solid (area × height)', () => {
    const doc = docOf(
      [
        prim('ext', {
          type: 'extrusion',
          profile: [
            [
              [0, 0],
              [10, 0],
              [10, 20],
              [0, 20],
            ],
          ],
          height: 5,
        }),
      ],
      ['ext'],
    )
    // 10 × 20 rectangle, extruded 5mm → 1000 mm³
    expect(measureSolid(M, doc, 'ext').volume).toBeCloseTo(1000, 0)
  })

  it('flip extrudes to the other side of the plane (−Z instead of +Z)', () => {
    const profile: Vec2[][] = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ]
    const zRange = (raw: { position: Float32Array }) => {
      let mn = Infinity
      let mx = -Infinity
      for (let i = 2; i < raw.position.length; i += 3) {
        mn = Math.min(mn, raw.position[i])
        mx = Math.max(mx, raw.position[i])
      }
      return [mn, mx]
    }
    const up = docOf([prim('u', { type: 'extrusion', profile, height: 5 })], ['u'])
    const down = docOf([prim('d', { type: 'extrusion', profile, height: 5, flip: true })], ['d'])
    const [umn, umx] = zRange(computeExportRaw(M, up, ['u']))
    const [dmn, dmx] = zRange(computeExportRaw(M, down, ['d']))
    expect(umn).toBeCloseTo(0, 3)
    expect(umx).toBeCloseTo(5, 3)
    expect(dmn).toBeCloseTo(-5, 3)
    expect(dmx).toBeCloseTo(0, 3)
  })

  it('revolves a profile into a solid of revolution (tube volume)', () => {
    // Rectangle x∈[5,15], y∈[0,10] revolved 360° around x=0 → tube R=15, r=5, h=10.
    const doc = docOf(
      [
        prim('rev', {
          type: 'revolution',
          profile: [
            [
              [5, 0],
              [15, 0],
              [15, 10],
              [5, 10],
            ],
          ],
          degrees: 360,
          segments: 64,
        }),
      ],
      ['rev'],
    )
    // π·(15² − 5²)·10 ≈ 6283; the 64-gon facets make it slightly less.
    const vol = measureSolid(M, doc, 'rev').volume
    expect(vol).toBeGreaterThan(6000)
    expect(vol).toBeLessThan(6300)
  })

  it('unions two disjoint boxes (volume ~16000)', () => {
    const doc = docOf(
      [
        prim('b1', { type: 'box', size: [20, 20, 20] }, [-20, 0, 0]),
        prim('b2', { type: 'box', size: [20, 20, 20] }, [20, 0, 0]),
      ],
      ['b1', 'b2'],
    )

    const raw = computeExportRaw(M, doc, ['b1', 'b2'])
    expect(raw.index.length).toBeGreaterThan(0)

    // Bounding box should span from -30 to +30 in X (two boxes, gap between).
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < raw.position.length; i += 3) {
      minX = Math.min(minX, raw.position[i])
      maxX = Math.max(maxX, raw.position[i])
    }
    expect(minX).toBeCloseTo(-30, 1)
    expect(maxX).toBeCloseTo(30, 1)
  })
})
