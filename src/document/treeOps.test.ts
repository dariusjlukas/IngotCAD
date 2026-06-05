import { beforeEach, describe, it, expect } from 'vitest'
import { useCadStore } from './store'
import { hasChildren } from './types'

const store = () => useCadStore.getState()
const node = (id: string) => store().doc.nodes[id]
const childIds = (id: string) => {
  const n = node(id)
  return hasChildren(n) ? n.childIds : []
}

beforeEach(() => store().newDocument())

describe('duplicateNodes', () => {
  it('clones a primitive as a nudged, selected sibling', () => {
    const a = store().addPrimitive('box')
    const before = node(a).transform.position
    const [dup] = store().duplicateNodes([a])
    expect(dup).not.toBe(a)
    expect(store().doc.rootIds).toEqual([a, dup])
    expect(store().selectedIds).toEqual([dup])
    // offset from the original so it isn't hidden behind it
    expect(node(dup).transform.position[0]).toBeGreaterThan(before[0])
  })

  it('deep-clones a group with fresh child ids', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const g = store().group([a, b])!
    const [dup] = store().duplicateNodes([g])
    const dupKids = childIds(dup)
    expect(dupKids).toHaveLength(2)
    expect(dupKids).not.toContain(a)
    expect(dupKids).not.toContain(b)
    // original is untouched
    expect(childIds(g)).toEqual([a, b])
  })

  it('does not double-duplicate a child whose parent is also selected', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const g = store().group([a, b])!
    const created = store().duplicateNodes([g, a])
    expect(created).toHaveLength(1) // only the group's subtree
  })
})

describe('copy / paste', () => {
  it('pastes a clone of the copied subtree as a new root', () => {
    const a = store().addPrimitive('box')
    store().copyNodes([a])
    const [pasted] = store().pasteClipboard()
    expect(pasted).not.toBe(a)
    expect(store().doc.rootIds).toEqual([a, pasted])
    expect(node(pasted).kind).toBe('primitive')
  })

  it('paste survives a new document (clipboard is independent of the doc)', () => {
    const a = store().addPrimitive('box')
    store().copyNodes([a])
    store().newDocument()
    const [pasted] = store().pasteClipboard()
    expect(store().doc.rootIds).toEqual([pasted])
  })
})

describe('moveNodes', () => {
  it('reorders root siblings', () => {
    const a = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    expect(store().doc.rootIds).toEqual([a, b])
    store().moveNodes([b], a, 'before')
    expect(store().doc.rootIds).toEqual([b, a])
  })

  it('reparents a node into a group (and out of the root list)', () => {
    const a = store().addPrimitive('box')
    const c = store().addPrimitive('box')
    const b = store().addPrimitive('cylinder')
    const g = store().group([a, c])! // group needs 2+ children
    store().moveNodes([b], g, 'inside')
    expect(store().doc.rootIds).toEqual([g])
    expect(childIds(g)).toContain(b)
  })

  it('refuses to drop a node into its own subtree', () => {
    const a = store().addPrimitive('box')
    const g = store().group([a, store().addPrimitive('box')])!
    const rootsBefore = [...store().doc.rootIds]
    store().moveNodes([g], a, 'inside') // g cannot become a child of its own descendant
    expect(store().doc.rootIds).toEqual(rootsBefore)
  })
})
