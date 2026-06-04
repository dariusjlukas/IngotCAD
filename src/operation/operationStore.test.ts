import { beforeEach, describe, it, expect } from 'vitest'
import { useOperationStore } from './operationStore'
import { useCadStore } from '../document/store'
import { IDENTITY_TRANSFORM } from '../document/types'

const op = () => useOperationStore.getState()
const cad = () => useCadStore.getState()

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
    op().start({ mode: 'extrude', profile: tri, transform: IDENTITY_TRANSFORM, segments: 64, value: -5, flip: false })
    expect(op().pending?.value).toBeCloseTo(0.1)
    op().setValue(999)
    expect(op().pending?.value).toBe(999) // extrude has no upper clamp

    op().cancel()
    op().start({ mode: 'revolve', profile: tri, transform: IDENTITY_TRANSFORM, segments: 64, value: 999, flip: false })
    expect(op().pending?.value).toBe(360)
  })

  it('setSignedValue auto-flips extrude on negative and keeps |value| positive', () => {
    const tri: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    ]
    op().start({ mode: 'extrude', profile: tri, transform: IDENTITY_TRANSFORM, segments: 64, value: 5, flip: false })
    op().setSignedValue(-12)
    expect(op().pending?.flip).toBe(true)
    expect(op().pending?.value).toBe(12)
    op().setSignedValue(8)
    expect(op().pending?.flip).toBe(false)
    expect(op().pending?.value).toBe(8)
  })
})
