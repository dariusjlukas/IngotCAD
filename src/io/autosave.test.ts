import { describe, it, expect } from 'vitest'
import { isDocumentEmpty } from './autosave'
import { createEmptyDocument } from '../document/types'

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
