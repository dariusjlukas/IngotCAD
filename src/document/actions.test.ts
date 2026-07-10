import { beforeEach, describe, it, expect } from 'vitest'
import { useCadStore } from './store'
import { hasChildren, IDENTITY_TRANSFORM } from './types'
import type { SketchSource } from './types'

const store = () => useCadStore.getState()

const SRC: SketchSource = {
  data: { points: {}, shapes: [], constraints: [] },
  plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
}
const TRI: [number, number][][] = [
  [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
]

beforeEach(() => store().newDocument())

describe('document actions', () => {
  it('adds a primitive as a selected root', () => {
    const id = store().addPrimitive('box')
    expect(store().doc.rootIds).toEqual([id])
    expect(store().doc.nodes[id].kind).toBe('primitive')
    expect(store().selectedIds).toEqual([id])
  })

  it('groups roots into a container and ungroups them back', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const g = store().group([a, b])
    expect(g).not.toBeNull()
    expect(store().doc.rootIds).toEqual([g])
    const group = store().doc.nodes[g!]
    expect(hasChildren(group) && group.childIds).toEqual([a, b])

    store().ungroup(g!)
    expect(store().doc.nodes[g!]).toBeUndefined()
    expect(store().doc.rootIds).toEqual([a, b])
  })

  it('wraps a single root in a pattern node and dissolves it on ungroup', () => {
    const a = store().addPrimitive('box')
    const p = store().patternNodes([a], {
      mode: 'linear',
      count: 4,
      offset: [10, 0, 0],
    })
    expect(p).not.toBeNull()
    expect(store().doc.rootIds).toEqual([p])
    const node = store().doc.nodes[p!]
    expect(node.kind).toBe('pattern')
    expect(node.kind === 'pattern' && node.spec.mode).toBe('linear')
    expect(hasChildren(node) && node.childIds).toEqual([a])
    // The wrapping modifier carries an identity transform (child keeps world pose).
    expect(node.transform).toEqual(IDENTITY_TRANSFORM)

    store().ungroup(p!)
    expect(store().doc.nodes[p!]).toBeUndefined()
    expect(store().doc.rootIds).toEqual([a])
  })

  it('shellNodes wraps the selection and is undoable', () => {
    const a = store().addPrimitive('box')
    const s = store().shellNodes([a], 2, true)
    const node = store().doc.nodes[s!]
    expect(node.kind).toBe('shell')
    expect(node.kind === 'shell' && node.thickness).toBe(2)
    expect(node.kind === 'shell' && node.openTop).toBe(true)
    expect(hasChildren(node) && node.childIds).toEqual([a])

    store().undo()
    expect(store().doc.rootIds).toEqual([a])
    expect(store().doc.nodes[s!]).toBeUndefined()
  })

  it('applyBoolean(subtract) keeps the selection order as base-then-cutters', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const d = store().applyBoolean([a, b], 'subtract')
    const node = store().doc.nodes[d!]
    expect(node.kind).toBe('boolean')
    expect(node.kind === 'boolean' && node.op).toBe('subtract')
    expect(hasChildren(node) && node.childIds).toEqual([a, b])
  })

  it('deletes a container and all of its descendants', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('box')
    const g = store().group([a, b])!
    store().deleteNodes([g])
    expect(store().doc.nodes[a]).toBeUndefined()
    expect(store().doc.nodes[b]).toBeUndefined()
    expect(store().doc.rootIds).toEqual([])
  })

  it('supports undo and redo', () => {
    const id = store().addPrimitive('box')
    expect(store().doc.rootIds).toEqual([id])
    store().undo()
    expect(store().doc.rootIds).toEqual([])
    store().redo()
    expect(store().doc.rootIds).toEqual([id])
  })

  it('appends created nodes to featureOrder', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const g = store().group([a, b])!
    expect(store().doc.featureOrder).toEqual([a, b, g])
  })

  it('addExtrusion stores the editable sketch and records the feature', () => {
    const id = store().addExtrusion(TRI, 5, IDENTITY_TRANSFORM, false, SRC)!
    expect(store().doc.featureOrder).toContain(id)
    const node = store().doc.nodes[id]
    expect(
      node.kind === 'primitive' && node.params.type === 'extrusion' && Boolean(node.params.sketch),
    ).toBe(true)
  })

  it('union and subtract extrude both take on the parent object color', () => {
    const box = store().addPrimitive('box')
    store().setNodeColor(box, '#123456')
    const u = store().addExtrusion(TRI, 5, IDENTITY_TRANSFORM, false, SRC, {
      targetId: box,
      op: 'union',
    })!
    const unionNode = store().doc.nodes[u]
    expect(unionNode.kind).toBe('boolean')
    expect(unionNode.color).toBe('#123456')

    const box2 = store().addPrimitive('box')
    store().setNodeColor(box2, '#abcdef')
    const s = store().addExtrusion(TRI, 5, IDENTITY_TRANSFORM, false, SRC, {
      targetId: box2,
      op: 'subtract',
    })!
    const subNode = store().doc.nodes[s]
    expect(subNode.kind).toBe('boolean')
    expect(subNode.color).toBe('#abcdef')
  })

  it('setNodeSketch replaces the profile + sketch in place (keeping height)', () => {
    const id = store().addExtrusion(TRI, 7, IDENTITY_TRANSFORM, false, SRC)!
    const newProfile: [number, number][][] = [
      [
        [0, 0],
        [20, 0],
        [20, 20],
      ],
    ]
    const newSrc: SketchSource = { ...SRC, plane: { ...SRC.plane, origin: [5, 0, 0] } }
    store().setNodeSketch(id, newProfile, newSrc)
    const node = store().doc.nodes[id]
    if (node.kind === 'primitive' && node.params.type === 'extrusion') {
      expect(node.params.height).toBe(7) // preserved
      expect(node.params.profile[0]).toHaveLength(3)
      expect(node.params.profile[0][1]).toEqual([20, 0])
      expect(node.params.sketch?.plane.origin).toEqual([5, 0, 0])
    } else {
      throw new Error('expected extrusion')
    }
  })

  it('records a transform edit as one undo step', () => {
    const id = store().addPrimitive('box')
    const original = store().doc.nodes[id].transform
    store().transformNode(id, { position: [50, 0, 0], rotationDeg: [0, 0, 0], scale: [1, 1, 1] })
    expect(store().doc.nodes[id].transform.position).toEqual([50, 0, 0])
    store().undo()
    expect(store().doc.nodes[id].transform).toEqual(original)
  })
})

describe('setNodeTransform (scale baking)', () => {
  it('bakes a box scale into its size and resets the scale, in one undo step', () => {
    const id = store().addPrimitive('box') // default size [20, 20, 20]
    const t = store().doc.nodes[id].transform
    store().setNodeTransform(id, { ...t, scale: [2, 1, 1] })

    const node = store().doc.nodes[id]
    expect(node.kind === 'primitive' && node.params.type === 'box' && node.params.size).toEqual([
      40, 20, 20,
    ])
    expect(node.transform.scale).toEqual([1, 1, 1])

    store().undo()
    const reverted = store().doc.nodes[id]
    expect(
      reverted.kind === 'primitive' && reverted.params.type === 'box' && reverted.params.size,
    ).toEqual([20, 20, 20])
  })

  it('keeps a non-uniform scale on a sphere (not representable as a radius)', () => {
    const id = store().addPrimitive('sphere') // default radius 12
    const t = store().doc.nodes[id].transform
    store().setNodeTransform(id, { ...t, scale: [2, 2, 1] })

    const node = store().doc.nodes[id]
    expect(node.kind === 'primitive' && node.params.type === 'sphere' && node.params.radius).toBe(
      12,
    )
    expect(node.transform.scale).toEqual([2, 2, 1])
  })

  it('leaves a group/container scale untouched (no params to bake into)', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('box')
    const g = store().group([a, b])!
    const t = store().doc.nodes[g].transform
    store().setNodeTransform(g, { ...t, scale: [2, 2, 2] })
    expect(store().doc.nodes[g].transform.scale).toEqual([2, 2, 2])
  })
})

describe('binding pruning regressions', () => {
  it('prunes bindings of containers cascade-deleted by deleting their last child', () => {
    const a = store().addPrimitive('box')
    const s = store().shellNodes([a], 2, false)!
    expect(store().setFieldBinding(s, 'thickness', '2.5')).toBe(true)
    expect(store().doc.bindings[`${s}:thickness`]).toBe('2.5')

    // Deleting the shell's only child cascade-deletes the (now empty) shell;
    // its binding must not survive into every future save of the document.
    store().deleteNodes([a])
    expect(store().doc.nodes[s]).toBeUndefined()
    expect(store().doc.bindings).toEqual({})
  })

  it('prunes bindings of containers emptied by moveNodes', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('box')
    const s = store().shellNodes([a], 2, false)!
    expect(store().setFieldBinding(s, 'thickness', '2.5')).toBe(true)

    // Move the shell's only child next to the other root: the empty shell is
    // cleaned up and its binding must go with it.
    store().moveNodes([a], b, 'after')
    expect(store().doc.nodes[s]).toBeUndefined()
    expect(store().doc.bindings).toEqual({})
  })
})
