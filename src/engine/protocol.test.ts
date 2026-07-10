import { describe, expect, it } from 'vitest'
import { fromWireDocument, rawMeshTransferList, toWireDocument } from './protocol'
import { EMPTY_MESH } from '../geometry/manifoldToThree'
import { createEmptyDocument } from '../document/types'
import type { MeshAsset } from '../document/types'

function asset(n: number): MeshAsset {
  return { position: new Float32Array([n, 0, 0]), index: new Uint32Array([0]) }
}

describe('wire document asset sync', () => {
  it('inlines only assets the worker does not know yet', () => {
    const doc = createEmptyDocument()
    doc.assets = { a1: asset(1), a2: asset(2) }
    const known = new Set(['a1'])
    const wire = toWireDocument(doc, known)
    expect(wire.assetIds.sort()).toEqual(['a1', 'a2'])
    expect(Object.keys(wire.inlineAssets)).toEqual(['a2'])
  })

  it('inlines everything on first contact and nothing once known', () => {
    const doc = createEmptyDocument()
    doc.assets = { a1: asset(1) }
    const first = toWireDocument(doc, new Set())
    expect(Object.keys(first.inlineAssets)).toEqual(['a1'])
    const second = toWireDocument(doc, new Set(['a1']))
    expect(Object.keys(second.inlineAssets)).toEqual([])
  })

  it('rehydrates a document from the worker cache', () => {
    const doc = createEmptyDocument()
    doc.assets = { a1: asset(1), a2: asset(2) }
    const wire = toWireDocument(doc, new Set(['a1', 'a2'])) // nothing inlined
    const cache = new Map(Object.entries({ a1: asset(1), a2: asset(2) }))
    const rebuilt = fromWireDocument(wire, cache)
    expect(Object.keys(rebuilt.assets).sort()).toEqual(['a1', 'a2'])
    expect(rebuilt.assets.a1.position[0]).toBe(1)
    expect(rebuilt.schemaVersion).toBe(doc.schemaVersion)
    expect('assetIds' in rebuilt).toBe(false)
    expect('inlineAssets' in rebuilt).toBe(false)
  })

  it('strips the assets record from the wire form (no double payload)', () => {
    const doc = createEmptyDocument()
    doc.assets = { a1: asset(1) }
    const wire = toWireDocument(doc, new Set())
    expect('assets' in wire).toBe(false)
  })
})

describe('rawMeshTransferList', () => {
  it('transfers both buffers of a real mesh', () => {
    const raw = {
      position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      index: new Uint32Array([0, 1, 2]),
    }
    expect(rawMeshTransferList(raw)).toEqual([raw.position.buffer, raw.index.buffer])
  })

  it('never transfers the shared EMPTY_MESH singleton buffers', () => {
    expect(rawMeshTransferList(EMPTY_MESH)).toEqual([])
  })

  it('omits zero-length buffers individually', () => {
    const position = new Float32Array([0, 0, 0])
    expect(rawMeshTransferList({ position, index: new Uint32Array(0) })).toEqual([position.buffer])
  })

  it('lists a buffer shared by both views only once', () => {
    const buffer = new ArrayBuffer(24)
    const raw = { position: new Float32Array(buffer, 0, 3), index: new Uint32Array(buffer, 12, 3) }
    expect(rawMeshTransferList(raw)).toEqual([buffer])
  })
})
