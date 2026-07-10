import { describe, it, expect } from 'vitest'
import { fullHash, localHash } from './hash'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode } from '../document/types'

function doc(...nodes: CadNode[]): CadDocument {
  const d = createEmptyDocument()
  for (const n of nodes) d.nodes[n.id] = n
  d.rootIds = nodes.filter((n) => n.id.startsWith('root')).map((n) => n.id)
  return d
}

function box(
  id: string,
  size: [number, number, number],
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
    params: { type: 'box', size },
  }
}

describe('structural hashing', () => {
  it("a primitive's local hash ignores its own transform", () => {
    const a = doc(box('root_a', [10, 10, 10], [0, 0, 0]))
    const b = doc(box('root_a', [10, 10, 10], [5, 2, 1]))
    expect(localHash(a, 'root_a')).toBe(localHash(b, 'root_a'))
    expect(fullHash(a, 'root_a')).not.toBe(fullHash(b, 'root_a'))
  })

  it('changing a child param invalidates its parent but not an unrelated root', () => {
    const group: CadNode = {
      id: 'root_g',
      kind: 'group',
      name: 'g',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM },
      childIds: ['c1', 'c2'],
    }
    const before = doc(
      group,
      box('c1', [10, 10, 10]),
      box('c2', [4, 4, 4]),
      box('root_other', [2, 2, 2]),
    )
    const after = doc(
      group,
      box('c1', [10, 10, 10]),
      box('c2', [4, 4, 9]),
      box('root_other', [2, 2, 2]),
    )

    expect(localHash(after, 'root_g')).not.toBe(localHash(before, 'root_g'))
    expect(localHash(after, 'root_other')).toBe(localHash(before, 'root_other'))
  })

  it("a child's role is part of the parent's hash", () => {
    const mkGroup = (childRole: 'solid' | 'hole'): CadDocument => {
      const d = createEmptyDocument()
      d.nodes['root_g'] = {
        id: 'root_g',
        kind: 'group',
        name: 'g',
        color: '#fff',
        visible: true,
        role: 'solid',
        transform: { ...IDENTITY_TRANSFORM },
        childIds: ['c1'],
      }
      d.nodes['c1'] = { ...box('c1', [4, 4, 4]), role: childRole }
      d.rootIds = ['root_g']
      return d
    }
    expect(localHash(mkGroup('solid'), 'root_g')).not.toBe(localHash(mkGroup('hole'), 'root_g'))
  })

  it('shell thickness 0 (no shell) hashes differently from a sub-quantum thickness', () => {
    // Evaluation branches discontinuously at thickness <= 0; quantization used
    // to collapse 4e-7 and 0 to the same hash, serving stale geometry.
    const mkShell = (thickness: number): CadDocument => {
      const d = createEmptyDocument()
      d.nodes['root_s'] = {
        id: 'root_s',
        kind: 'shell',
        name: 's',
        color: '#fff',
        visible: true,
        role: 'solid',
        transform: { ...IDENTITY_TRANSFORM },
        thickness,
        openTop: false,
        childIds: ['c1'],
      }
      d.nodes['c1'] = box('c1', [10, 10, 10])
      d.rootIds = ['root_s']
      return d
    }
    expect(localHash(mkShell(0), 'root_s')).not.toBe(localHash(mkShell(4e-7), 'root_s'))
    expect(localHash(mkShell(0), 'root_s')).toBe(localHash(mkShell(-1), 'root_s')) // both: no shell
  })
})
