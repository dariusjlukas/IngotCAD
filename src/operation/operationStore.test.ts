import { beforeEach, describe, it, expect } from 'vitest'
import { useOperationStore } from './operationStore'
import { useCadStore } from '../document/store'
import { IDENTITY_TRANSFORM } from '../document/types'
import type { SketchSource } from '../document/types'

const op = () => useOperationStore.getState()
const cad = () => useCadStore.getState()

const SRC: SketchSource = {
  data: { points: {}, shapes: [], constraints: [] },
  plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
}

beforeEach(() => {
  cad().newDocument()
  op().cancel()
})

describe('operation store', () => {
  it('confirm creates the solid as one document node', () => {
    op().start({
      mode: 'extrude',
      profile: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 5,
      flip: false,
      sketch: SRC,
    })
    op().setValue(8)
    expect(op().pending?.value).toBe(8)

    op().confirm()
    expect(op().pending).toBeNull()
    const roots = cad().doc.rootIds
    expect(roots).toHaveLength(1)
    const node = cad().doc.nodes[roots[0]]
    expect(node.kind === 'primitive' && node.params.type).toBe('extrusion')
  })

  it('cancel discards without creating a node', () => {
    op().start({
      mode: 'revolve',
      profile: [
        [
          [5, 0],
          [10, 0],
          [10, 5],
          [5, 5],
        ],
      ],
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 180,
      flip: false,
      sketch: SRC,
    })
    op().cancel()
    expect(op().pending).toBeNull()
    expect(cad().doc.rootIds).toHaveLength(0)
  })

  it('clamps the value per mode', () => {
    const tri: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]
    op().start({
      mode: 'extrude',
      profile: tri,
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: -5,
      flip: false,
      sketch: SRC,
    })
    expect(op().pending?.value).toBeCloseTo(0.1)
    op().setValue(999)
    expect(op().pending?.value).toBe(999) // extrude has no upper clamp

    op().cancel()
    op().start({
      mode: 'revolve',
      profile: tri,
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 999,
      flip: false,
      sketch: SRC,
    })
    expect(op().pending?.value).toBe(360)
  })

  const SQUARE: [number, number][][] = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ]

  const startOnObject = (sourceNodeId: string) =>
    op().start({
      mode: 'extrude',
      profile: SQUARE,
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 5,
      flip: false,
      sketch: SRC,
      sourceNodeId,
    })

  it('defaults to union when the sketch was drawn on an object', () => {
    const box = cad().addPrimitive('box')
    startOnObject(box)
    expect(op().pending?.combine).toBe('union')
  })

  it('confirm with union folds the new solid into the source object', () => {
    const box = cad().addPrimitive('box')
    startOnObject(box)
    op().confirm()
    const roots = cad().doc.rootIds
    expect(roots).toHaveLength(1)
    const node = cad().doc.nodes[roots[0]]
    expect(node.kind).toBe('boolean')
    if (node.kind === 'boolean') {
      expect(node.op).toBe('union')
      // Child order is [target, new]: the source object first.
      expect(node.childIds[0]).toBe(box)
      expect(node.childIds).toHaveLength(2)
      expect(cad().doc.nodes[node.childIds[1]].kind).toBe('primitive')
    }
    expect(cad().selectedIds).toEqual([roots[0]])
  })

  it('confirm with subtract cuts the new solid out of the source object', () => {
    const box = cad().addPrimitive('box')
    startOnObject(box)
    op().setCombine('subtract')
    op().confirm()
    const roots = cad().doc.rootIds
    expect(roots).toHaveLength(1)
    const node = cad().doc.nodes[roots[0]]
    expect(node.kind === 'boolean' && node.op).toBe('subtract')
    // First child (minuend) must be the existing object.
    expect(node.kind === 'boolean' && node.childIds[0]).toBe(box)
  })

  it('confirm with new keeps the result as a separate object', () => {
    const box = cad().addPrimitive('box')
    startOnObject(box)
    op().setCombine('new')
    op().confirm()
    const roots = cad().doc.rootIds
    expect(roots).toHaveLength(2)
    expect(roots).toContain(box)
  })

  it('a cardinal-plane sketch has no source object and defaults to new', () => {
    op().start({
      mode: 'extrude',
      profile: SQUARE,
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 5,
      flip: false,
      sketch: SRC,
    })
    expect(op().pending?.sourceNodeId).toBeNull()
    expect(op().pending?.combine).toBe('new')
  })

  it('setSignedValue auto-flips extrude on negative and keeps |value| positive', () => {
    const tri: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]
    op().start({
      mode: 'extrude',
      profile: tri,
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 5,
      flip: false,
      sketch: SRC,
    })
    op().setSignedValue(-12)
    expect(op().pending?.flip).toBe(true)
    expect(op().pending?.value).toBe(12)
    op().setSignedValue(8)
    expect(op().pending?.flip).toBe(false)
    expect(op().pending?.value).toBe(8)
  })
})
