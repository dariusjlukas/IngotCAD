/** Save / open a project as a JSON file. */
import { deserializeDocument, serializeDocument } from '../document/serialization'
import { useCadStore } from '../document/store'
import { downloadBlob } from './download'

export function saveProject(filename = 'model.hcad.json'): void {
  const json = serializeDocument(useCadStore.getState().doc)
  downloadBlob(new Blob([json], { type: 'application/json' }), filename)
}

export async function openProjectFile(file: File): Promise<void> {
  const text = await file.text()
  const doc = deserializeDocument(text)
  useCadStore.getState().loadDocument(doc)
}
