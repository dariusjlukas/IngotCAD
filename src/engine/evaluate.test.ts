import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { computeExportRaw, measureSolid } from './evaluate'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode, PrimitiveParams } from '../document/types'

let M: ManifoldToplevel

beforeAll(async () => {
  M = await Module()
  M.setup()
})

function prim(id: string, params: PrimitiveParams, pos: [number, number, number] = [0, 0, 0]): CadNode {
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
