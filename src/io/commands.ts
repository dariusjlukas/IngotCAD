/**
 * App-level file commands shared by the menu bar, context menus and the keyboard
 * shortcuts, so they all go through one code path (with the same unsaved-changes
 * guard) and report results via toasts.
 */
import { useCadStore } from '../document/store'
import { toast } from '../ui/toastStore'
import {
  openProjectFile,
  projectFilename,
  saveProject as saveProjectFile,
  saveProjectAs,
} from './projectFile'
import { exportStl } from './stlExport'
import { export3mf } from './threemfExport'
import { importStlFile } from './stlImport'

/** True if it's safe to discard the current document (clean, or user confirms). */
export function confirmDiscard(): boolean {
  return !useCadStore.getState().dirty || window.confirm('Discard unsaved changes?')
}

/** Open a transient OS file picker and hand the chosen file to `onFile`. */
function pickFile(accept: string, onFile: (file: File) => void): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) onFile(file)
  })
  input.click()
}

function hasVisibleGeometry(): boolean {
  const doc = useCadStore.getState().doc
  return doc.rootIds.some((id) => doc.nodes[id]?.visible)
}

export function newProject(): void {
  if (confirmDiscard()) useCadStore.getState().newDocument()
}

export function openProject(): void {
  if (confirmDiscard()) {
    pickFile('.json,.hcad,.hcad.json', (file) => {
      void openProjectFile(file)
        .then(() => toast.success(`Opened ${file.name}`))
        .catch((err) => toast.error(`Couldn't open file: ${err}`))
    })
  }
}

export function importStl(): void {
  pickFile('.stl', (file) => {
    void importStlFile(file)
      .then(() => toast.success(`Imported ${file.name}`))
      .catch((err) => toast.error(`Import failed: ${err}`))
  })
}

export function saveProject(): void {
  saveProjectFile()
  toast.success(`Saved ${projectFilename('hcad.json')}`)
}

/** Prompt for a name, then save (Save As…). */
export function saveAs(): void {
  const name = window.prompt('Save project as:', useCadStore.getState().documentName)
  if (name && name.trim()) {
    saveProjectAs(name)
    toast.success(`Saved ${projectFilename('hcad.json')}`)
  }
}

export async function exportStlFile(): Promise<void> {
  if (!hasVisibleGeometry()) {
    toast.error('Nothing to export')
    return
  }
  const filename = projectFilename('stl')
  try {
    if (await exportStl(useCadStore.getState().doc, filename)) {
      toast.success(`Exported ${filename}`)
    } else {
      toast.error('Nothing to export — the model evaluates to empty geometry.')
    }
  } catch (err) {
    toast.error(`Export failed: ${err}`)
  }
}

export async function export3mfFile(): Promise<void> {
  if (!hasVisibleGeometry()) {
    toast.error('Nothing to export')
    return
  }
  const filename = projectFilename('3mf')
  try {
    if (await export3mf(useCadStore.getState().doc, filename)) {
      toast.success(`Exported ${filename}`)
    } else {
      toast.error('Nothing to export — the model evaluates to empty geometry.')
    }
  } catch (err) {
    toast.error(`Export failed: ${err}`)
  }
}
