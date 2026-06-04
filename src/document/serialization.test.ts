import { describe, it, expect } from 'vitest'
import { serializeDocument, deserializeDocument } from './serialization'
import { createEmptyDocument } from './types'
import type { CadDocument, SketchSource } from './types'

function docWithExtrusion(): CadDocument {
  const doc = createEmptyDocument()
  const sketch: SketchSource = {
    data: {
      points: { a: { x: 0, y: 0, fixed: false } },
      shapes: [{ id: 's', kind: 'loop', pts: ['a'] }],
      constraints: [{ id: 'c', kind: 'distance', a: 'a', b: 'a', value: 10 }],
    },
    plane: { origin: [1, 2, 3], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
  }
  doc.nodes['n'] = {
    id: 'n',
    kind: 'primitive',
    name: 'Sketch 1',
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { position: [0, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] },
    params: {
      type: 'extrusion',
      profile: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
      ],
      height: 5,
      flip: false,
      sketch,
    },
  }
  doc.rootIds = ['n']
  doc.featureOrder = ['n']
  return doc
}

describe('serialization', () => {
  it('round-trips a document with a sketch source + featureOrder', () => {
    const back = deserializeDocument(serializeDocument(docWithExtrusion()))
    expect(back.featureOrder).toEqual(['n'])
    const node = back.nodes['n']
    expect(node.kind).toBe('primitive')
    if (node.kind === 'primitive' && node.params.type === 'extrusion') {
      expect(node.params.height).toBe(5)
      expect(node.params.sketch?.plane.origin).toEqual([1, 2, 3])
      expect(node.params.sketch?.data.shapes[0].kind).toBe('loop')
      expect(node.params.sketch?.data.constraints[0].kind).toBe('distance')
    } else {
      throw new Error('expected an extrusion')
    }
  })

  it('falls back featureOrder to node order for files that predate it', () => {
    const json = JSON.parse(serializeDocument(docWithExtrusion())) as Record<string, unknown>
    delete json.featureOrder
    const back = deserializeDocument(JSON.stringify(json))
    expect(back.featureOrder).toEqual(['n'])
  })
})
