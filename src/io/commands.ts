/**
 * App-level file commands shared by the menu bar and the keyboard shortcuts, so
 * both go through one code path (with the same unsaved-changes guard).
 */
import { useCadStore } from '../document/store'
import { openProjectFile, saveProject, saveProjectAs } from './projectFile'
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

export function newProject(): void {
  if (confirmDiscard()) useCadStore.getState().newDocument()
}

export function openProject(): void {
  if (confirmDiscard()) {
    pickFile(
      '.json,.hcad,.hcad.json',
      (file) => void openProjectFile(file).catch((err) => alert(String(err))),
    )
  }
}

export function importStl(): void {
  pickFile('.stl', (file) => void importStlFile(file))
}

/** Prompt for a name, then save (Save As…). */
export function saveAs(): void {
  const name = window.prompt('Save project as:', useCadStore.getState().documentName)
  if (name && name.trim()) saveProjectAs(name)
}

export { saveProject }
