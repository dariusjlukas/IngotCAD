/** Variables + expression bindings: store behavior and serialization. */
import { beforeEach, describe, expect, it } from 'vitest'
import { useCadStore } from './store'
import { bindingKey, getByPath, setByPath } from './bindings'
import { deserializeDocument, serializeDocument } from './serialization'
import type { PrimitiveNode } from './types'

const store = () => useCadStore.getState()
const params = (id: string) => (store().doc.nodes[id] as PrimitiveNode).params

beforeEach(() => store().newDocument())

describe('setByPath / getByPath', () => {
  it('writes numeric leaves only, never creating properties', () => {
    const a = store().addPrimitive('box')!
    const node = structuredClone(store().doc.nodes[a]) as PrimitiveNode
    expect(setByPath(node, 'params.size.1', 42)).toBe(true)
    expect(getByPath(node, 'params.size.1')).toBe(42)
    expect(setByPath(node, 'params.nope', 1)).toBe(false)
    expect(setByPath(node, 'params.type', 1)).toBe(false) // string leaf
    expect(setByPath(node, 'deep.missing.path', 1)).toBe(false)
  })
})

describe('variables + bindings', () => {
  it('binding a field writes the evaluated value and survives variable edits', () => {
    store().setVariable('wall', '2.5')
    const a = store().addPrimitive('box')!
    expect(store().setFieldBinding(a, 'params.size.0', 'wall * 4')).toBe(true)
    expect(getByPath(store().doc.nodes[a], 'params.size.0')).toBe(10)

    // Editing the variable rewrites the bound field…
    store().setVariable('wall', '3')
    expect(getByPath(store().doc.nodes[a], 'params.size.0')).toBe(12)
    // …as ONE undo step (variable + ripple together).
    store().undo()
    expect(store().doc.variables.find((v) => v.name === 'wall')?.expr).toBe('2.5')
    expect(getByPath(store().doc.nodes[a], 'params.size.0')).toBe(10)
  })

  it('variables can reference each other', () => {
    store().setVariable('wall', '2')
    store().setVariable('total', 'wall * 3 + 1')
    const a = store().addPrimitive('cylinder')!
    store().setFieldBinding(a, 'params.height', 'total')
    expect((params(a) as { height: number }).height).toBe(7)
    store().setVariable('wall', '4')
    expect((params(a) as { height: number }).height).toBe(13)
  })

  it('rejects invalid names and unevaluable expressions without touching history', () => {
    expect(store().setVariable('2bad', '1')).toBe(false)
    expect(store().setVariable('pi', '1')).toBe(false)
    const a = store().addPrimitive('box')!
    const before = store().past.length
    expect(store().setFieldBinding(a, 'params.size.0', 'missing + 1')).toBe(false)
    expect(store().setFieldBinding(a, 'params.nonexistent', '1')).toBe(false)
    expect(store().past.length).toBe(before)
  })

  it('typing a plain number clears the binding in one step', () => {
    store().setVariable('wall', '2')
    const a = store().addPrimitive('box')!
    store().setFieldBinding(a, 'params.size.2', 'wall * 10')
    expect(getByPath(store().doc.nodes[a], 'params.size.2')).toBe(20)
    store().setFieldBinding(a, 'params.size.2', null, 7)
    expect(getByPath(store().doc.nodes[a], 'params.size.2')).toBe(7)
    expect(store().doc.bindings[bindingKey(a, 'params.size.2')]).toBeUndefined()
    // Variable edits no longer touch the field.
    store().setVariable('wall', '9')
    expect(getByPath(store().doc.nodes[a], 'params.size.2')).toBe(7)
  })

  it('removing a variable keeps bound fields at their last value', () => {
    store().setVariable('wall', '2')
    const a = store().addPrimitive('box')!
    store().setFieldBinding(a, 'params.size.0', 'wall')
    store().removeVariable('wall')
    expect(getByPath(store().doc.nodes[a], 'params.size.0')).toBe(2)
    // The binding still exists (broken) but stops evaluating.
    expect(store().doc.bindings[bindingKey(a, 'params.size.0')]).toBe('wall')
  })

  it('deleting a node prunes its bindings', () => {
    store().setVariable('wall', '2')
    const a = store().addPrimitive('box')!
    store().setFieldBinding(a, 'params.size.0', 'wall')
    store().deleteNodes([a])
    expect(Object.keys(store().doc.bindings)).toHaveLength(0)
  })
})

describe('serialization', () => {
  it('round-trips variables and bindings', () => {
    store().setVariable('wall', '2.4')
    const a = store().addPrimitive('box')!
    store().setFieldBinding(a, 'params.size.0', 'wall * 2')
    const text = serializeDocument(store().doc)
    const doc = deserializeDocument(text)
    expect(doc.variables).toEqual([{ name: 'wall', expr: '2.4' }])
    expect(doc.bindings[bindingKey(a, 'params.size.0')]).toBe('wall * 2')
    expect(getByPath(doc.nodes[a], 'params.size.0')).toBeCloseTo(4.8)
  })
})
