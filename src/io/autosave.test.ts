// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, it, expect, beforeEach } from 'vitest'
import { isDocumentEmpty, writeAutosave, restoreAutosave } from './autosave'
import { serializeDocument } from '../document/serialization'
import { useCadStore } from '../document/store'
import { createEmptyDocument } from '../document/types'
import type { CadDocument } from '../document/types'

describe('isDocumentEmpty', () => {
  it('treats a fresh document as empty', () => {
    expect(isDocumentEmpty(createEmptyDocument())).toBe(true)
  })

  it('treats a document with root nodes as non-empty', () => {
    const doc = createEmptyDocument()
    doc.rootIds.push('node-1')
    expect(isDocumentEmpty(doc)).toBe(false)
  })

  it('treats a document with only variables as non-empty', () => {
    const doc = createEmptyDocument()
    doc.variables.push({ name: 'wall', expr: '2.4' })
    expect(isDocumentEmpty(doc)).toBe(false)
  })

  it('treats a document with only construction planes as non-empty', () => {
    const doc = createEmptyDocument()
    doc.planeOrder.push('plane-1')
    expect(isDocumentEmpty(doc)).toBe(false)
  })

  it('treats a document with only mesh assets as non-empty', () => {
    const doc = createEmptyDocument()
    doc.assets['asset-1'] = { position: new Float32Array(9), index: new Uint32Array(3) }
    expect(isDocumentEmpty(doc)).toBe(false)
  })
})

/** A non-empty document carrying a mesh asset with distinctive byte patterns. */
function docWithMeshAsset(): CadDocument {
  const doc = createEmptyDocument()
  doc.assets['asset-1'] = {
    position: new Float32Array([0, 0, 0, 10.5, 0, 0, 0, 20.25, 0]),
    index: new Uint32Array([0, 1, 2]),
  }
  return doc
}

describe('autosave (IndexedDB)', () => {
  beforeEach(() => {
    // Fresh IndexedDB, localStorage, and document for every test.
    globalThis.indexedDB = new IDBFactory()
    localStorage.clear()
    useCadStore.getState().newDocument()
  })

  it('round-trips a document with a mesh asset, typed arrays intact', async () => {
    useCadStore.getState().loadDocument(docWithMeshAsset(), 'Bracket')
    await writeAutosave()

    useCadStore.getState().newDocument()
    expect(await restoreAutosave()).toBe(true)

    const { doc, documentName } = useCadStore.getState()
    expect(documentName).toBe('Bracket')
    const asset = doc.assets['asset-1']
    // Realm-safe typed-array checks: fake-indexeddb clones via Node's
    // structuredClone, so `instanceof` against jsdom's globals would fail.
    expect(asset.position.constructor.name).toBe('Float32Array')
    expect(asset.index.constructor.name).toBe('Uint32Array')
    expect(Array.from(asset.position)).toEqual([0, 0, 0, 10.5, 0, 0, 0, 20.25, 0])
    expect(Array.from(asset.index)).toEqual([0, 1, 2])
  })

  it('clears the record when the document becomes empty', async () => {
    useCadStore.getState().loadDocument(docWithMeshAsset(), 'Bracket')
    await writeAutosave()

    useCadStore.getState().newDocument()
    await writeAutosave() // empty document — must delete the slot

    expect(await restoreAutosave()).toBe(false)
    expect(isDocumentEmpty(useCadStore.getState().doc)).toBe(true)
  })

  it('does not clobber in-progress work on restore', async () => {
    useCadStore.getState().loadDocument(docWithMeshAsset(), 'Saved')
    await writeAutosave()

    const inProgress = createEmptyDocument()
    inProgress.variables.push({ name: 'wall', expr: '2.4' })
    useCadStore.getState().loadDocument(inProgress, 'In progress')

    expect(await restoreAutosave()).toBe(false)
    const { doc, documentName } = useCadStore.getState()
    expect(documentName).toBe('In progress')
    expect(doc.variables).toEqual([{ name: 'wall', expr: '2.4' }])
  })

  it('migrates a legacy localStorage autosave, then removes the key', async () => {
    const legacy = { name: 'Old project', document: serializeDocument(docWithMeshAsset()) }
    localStorage.setItem('ingot-autosave', JSON.stringify(legacy))

    expect(await restoreAutosave()).toBe(true)
    const { doc, documentName } = useCadStore.getState()
    expect(documentName).toBe('Old project')
    expect(Array.from(doc.assets['asset-1'].position)).toEqual([0, 0, 0, 10.5, 0, 0, 0, 20.25, 0])
    expect(localStorage.getItem('ingot-autosave')).toBeNull()

    // The migrated record now lives in IndexedDB: a later restore still finds it.
    useCadStore.getState().newDocument()
    expect(await restoreAutosave()).toBe(true)
    expect(useCadStore.getState().documentName).toBe('Old project')
  })

  it('prefers the IndexedDB record over a stale legacy localStorage slot', async () => {
    useCadStore.getState().loadDocument(docWithMeshAsset(), 'Current')
    await writeAutosave()
    localStorage.setItem(
      'ingot-autosave',
      JSON.stringify({ name: 'Stale', document: serializeDocument(docWithMeshAsset()) }),
    )

    useCadStore.getState().newDocument()
    expect(await restoreAutosave()).toBe(true)
    expect(useCadStore.getState().documentName).toBe('Current')
    // Untouched: migration only runs when IndexedDB has no record.
    expect(localStorage.getItem('ingot-autosave')).not.toBeNull()
  })

  it('degrades to a no-op when IndexedDB is unavailable', async () => {
    globalThis.indexedDB = undefined as unknown as IDBFactory
    useCadStore.getState().loadDocument(docWithMeshAsset(), 'Bracket')
    await expect(writeAutosave()).resolves.toBeUndefined()
    expect(await restoreAutosave()).toBe(false)
  })
})
