/**
 * Local autosave: mirror the current document to IndexedDB (debounced) so a
 * refresh or crash doesn't lose work, and restore it on startup. The document
 * is stored via structured clone — typed arrays (mesh assets) store natively,
 * with no JSON serialization and no localStorage quota to hit. An empty
 * document clears the slot, so "New" wipes it.
 */
import { deserializeDocument } from '../document/serialization'
import { useCadStore } from '../document/store'
import type { CadDocument } from '../document/types'

/** Pre-IndexedDB autosave slot: { name, document } with a JSON-serialized document. */
const LEGACY_KEY = 'ingot-autosave'
const DB_NAME = 'ingot'
const DB_VERSION = 1
const STORE_NAME = 'autosave'
const RECORD_KEY = 'latest'
const DEBOUNCE_MS = 1000

interface AutosaveRecord {
  name: string
  doc: CadDocument
  savedAt: number
}

/**
 * True when the document holds no user work at all. Nodes aren't the only
 * work worth keeping: variables, construction planes, and imported mesh
 * assets are real state too — a doc with only those must still autosave.
 * Exported for tests.
 */
export function isDocumentEmpty(doc: CadDocument): boolean {
  return (
    doc.rootIds.length === 0 &&
    doc.planeOrder.length === 0 &&
    doc.variables.length === 0 &&
    Object.keys(doc.assets).length === 0
  )
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/** Run one request against the autosave store and resolve with its result. */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    })
  } finally {
    db.close()
  }
}

/** Write the current document to the autosave slot immediately. Exported for tests. */
export async function writeAutosave(): Promise<void> {
  const { doc, documentName } = useCadStore.getState()
  try {
    if (isDocumentEmpty(doc)) {
      await withStore('readwrite', (store) => store.delete(RECORD_KEY))
      return
    }
    const record: AutosaveRecord = { name: documentName, doc, savedAt: Date.now() }
    await withStore('readwrite', (store) => store.put(record, RECORD_KEY))
  } catch {
    // IndexedDB unavailable (e.g. some private-browsing modes) or a write
    // failure — autosave is best-effort, so drop it silently.
  }
}

/** Begin mirroring document/name changes to IndexedDB. Returns an unsubscribe. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  return useCadStore.subscribe((state, prev) => {
    if (state.doc === prev.doc && state.documentName === prev.documentName) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void writeAutosave(), DEBOUNCE_MS)
  })
}

/**
 * One-time migration from the old localStorage slot: copy it into IndexedDB
 * first, then remove the key, so the legacy autosave can't be lost even if
 * the restore itself is skipped (e.g. work already in progress).
 */
async function migrateLegacyRecord(): Promise<AutosaveRecord | undefined> {
  const raw = localStorage.getItem(LEGACY_KEY)
  if (!raw) return undefined
  const { name, document } = JSON.parse(raw) as { name: string; document: string }
  const record: AutosaveRecord = {
    name,
    doc: deserializeDocument(document),
    savedAt: Date.now(),
  }
  await withStore('readwrite', (store) => store.put(record, RECORD_KEY))
  localStorage.removeItem(LEGACY_KEY)
  return record
}

async function readRecord(): Promise<AutosaveRecord | undefined> {
  const record = (await withStore('readonly', (store) => store.get(RECORD_KEY))) as
    | AutosaveRecord
    | undefined
  return record ?? (await migrateLegacyRecord())
}

/** Restore a previous session if one exists and the current document is empty. */
export async function restoreAutosave(): Promise<boolean> {
  try {
    const record = await readRecord()
    if (!record) return false
    if (isDocumentEmpty(record.doc)) return false
    if (!isDocumentEmpty(useCadStore.getState().doc)) return false // don't clobber work
    useCadStore.getState().loadDocument(record.doc, record.name || 'Untitled')
    return true
  } catch {
    return false
  }
}
