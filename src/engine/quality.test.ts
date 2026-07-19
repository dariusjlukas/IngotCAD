import { describe, it, expect } from 'vitest'
import { applyDraftQuality } from './quality'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode, PrimitiveParams } from '../document/types'

function primitive(id: string, params: PrimitiveParams): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM },
    params,
  }
}

function doc(...nodes: CadNode[]): CadDocument {
  const d = createEmptyDocument()
  for (const n of nodes) d.nodes[n.id] = n
  d.rootIds = nodes.map((n) => n.id)
  return d
}

function segmentsOf(d: CadDocument, id: string): number {
  const node = d.nodes[id]
  if (node.kind !== 'primitive' || !('segments' in node.params)) throw new Error('no segments')
  return node.params.segments
}

describe('applyDraftQuality', () => {
  it('halves segments on cylinders, spheres, and revolutions', () => {
    const input = doc(
      primitive('cyl', {
        type: 'cylinder',
        height: 10,
        radiusBottom: 5,
        radiusTop: 5,
        segments: 64,
      }),
      primitive('sph', { type: 'sphere', radius: 5, segments: 24 }),
      primitive('rev', {
        type: 'revolution',
        profile: [
          [
            [1, 0],
            [2, 0],
            [2, 5],
          ],
        ],
        degrees: 360,
        segments: 48,
      }),
    )
    const out = applyDraftQuality(input)
    expect(segmentsOf(out, 'cyl')).toBe(32)
    expect(segmentsOf(out, 'sph')).toBe(12)
    expect(segmentsOf(out, 'rev')).toBe(24)
  })

  it('clamps the reduced segment count at 8', () => {
    const input = doc(primitive('sph', { type: 'sphere', radius: 5, segments: 12 }))
    expect(segmentsOf(applyDraftQuality(input), 'sph')).toBe(8)
  })

  it('shares unchanged nodes by reference and copies only changed ones', () => {
    const input = doc(
      primitive('box', { type: 'box', size: [10, 10, 10] }),
      primitive('low', { type: 'sphere', radius: 5, segments: 8 }),
      primitive('sph', { type: 'sphere', radius: 5, segments: 32 }),
    )
    const out = applyDraftQuality(input)
    expect(out).not.toBe(input)
    expect(out.nodes.box).toBe(input.nodes.box)
    expect(out.nodes.low).toBe(input.nodes.low)
    expect(out.nodes.sph).not.toBe(input.nodes.sph)
    expect(out.rootIds).toBe(input.rootIds)
    expect(out.assets).toBe(input.assets)
  })

  it('returns the input document unchanged when nothing reduces', () => {
    const input = doc(
      primitive('box', { type: 'box', size: [10, 10, 10] }),
      primitive('low', { type: 'sphere', radius: 5, segments: 8 }),
    )
    expect(applyDraftQuality(input)).toBe(input)
  })

  it('does not mutate the input document', () => {
    const input = doc(primitive('sph', { type: 'sphere', radius: 5, segments: 32 }))
    const nodesBefore = input.nodes
    const nodeBefore = input.nodes.sph
    applyDraftQuality(input)
    expect(input.nodes).toBe(nodesBefore)
    expect(input.nodes.sph).toBe(nodeBefore)
    expect(segmentsOf(input, 'sph')).toBe(32)
  })
})
