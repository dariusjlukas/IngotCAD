/** Save / open a project as a JSON file, named after the current document. */
import { deserializeDocument, serializeDocument } from '../document/serialization'
import { useCadStore } from '../document/store'
import { downloadBlob } from './download'

/** Turn a document name into a filesystem-safe base (no extension). */
function safeBase(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_')
  return cleaned || 'model'
}

/** A download filename for the current document with the given extension. */
export function projectFilename(ext: string): string {
  return `${safeBase(useCadStore.getState().documentName)}.${ext}`
}

export function saveProject(): void {
  const { doc, markSaved } = useCadStore.getState()
  const json = serializeDocument(doc)
  downloadBlob(new Blob([json], { type: 'application/json' }), projectFilename('hcad.json'))
  markSaved()
}

/** Rename the document, then save (Save As…). */
export function saveProjectAs(name: string): void {
  const trimmed = name.trim()
  if (trimmed) useCadStore.getState().setDocumentName(trimmed)
  saveProject()
}

export async function openProjectFile(file: File): Promise<void> {
  const text = await file.text()
  const doc = deserializeDocument(text)
  const name = file.name.replace(/(\.hcad)?(\.json)?$/i, '') || 'Untitled'
  useCadStore.getState().loadDocument(doc, name)
}
