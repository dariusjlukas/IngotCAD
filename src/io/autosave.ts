/**
 * Local autosave: mirror the current document to localStorage (debounced) so a
 * refresh or crash doesn't lose work, and restore it on startup. Reuses the
 * project serialization. An empty document clears the slot, so "New" wipes it.
 */
import { deserializeDocument, serializeDocument } from '../document/serialization'
import { useCadStore } from '../document/store'

const KEY = 'ingot-autosave'
const DEBOUNCE_MS = 1000

interface AutosavePayload {
  name: string
  document: string
}

function write(): void {
  const { doc, documentName } = useCadStore.getState()
  try {
    if (doc.rootIds.length === 0) {
      localStorage.removeItem(KEY)
      return
    }
    const payload: AutosavePayload = { name: documentName, document: serializeDocument(doc) }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded (e.g. a large imported mesh) or serialization failure —
    // autosave is best-effort, so drop it silently.
  }
}

/** Begin mirroring document/name changes to localStorage. Returns an unsubscribe. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return useCadStore.subscribe((state, prev) => {
    if (state.doc === prev.doc && state.documentName === prev.documentName) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, DEBOUNCE_MS)
  })
}

/** Restore a previous session if one exists and the current document is empty. */
export function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const { name, document } = JSON.parse(raw) as AutosavePayload
    const doc = deserializeDocument(document)
    if (doc.rootIds.length === 0) return false
    if (useCadStore.getState().doc.rootIds.length > 0) return false // don't clobber work
    useCadStore.getState().loadDocument(doc, name || 'Untitled')
    return true
  } catch {
    return false
  }
}
