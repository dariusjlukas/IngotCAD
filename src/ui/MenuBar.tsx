/**
 * The top application menu bar (File · Edit · View · Help) plus the document
 * title with an unsaved-changes dot and a quick settings control. App-level
 * commands live here; the toolbar below holds modeling tools only.
 */
import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear } from '@fortawesome/free-solid-svg-icons'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'
import { useDialogStore } from './dialogStore'
import { useCadStore } from '../document/store'
import { selectCanRedo, selectCanUndo } from '../document/selectors'
import { usePrefsStore } from '../preferences/prefsStore'
import type { ThemePreference } from '../preferences/prefsStore'
import { exportStl } from '../io/stlExport'
import { export3mf } from '../io/threemfExport'
import { projectFilename } from '../io/projectFile'
import { importStl, newProject, openProject, saveAs, saveProject } from '../io/commands'

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

export function MenuBar() {
  const documentName = useCadStore((s) => s.documentName)
  const dirty = useCadStore((s) => s.dirty)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const canUndo = useCadStore(selectCanUndo)
  const canRedo = useCadStore(selectCanRedo)

  const undo = useCadStore((s) => s.undo)
  const redo = useCadStore((s) => s.redo)
  const deleteNodes = useCadStore((s) => s.deleteNodes)

  const theme = usePrefsStore((s) => s.theme)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const gridEnabled = usePrefsStore((s) => s.gridEnabled)
  const setGridEnabled = usePrefsStore((s) => s.setGridEnabled)

  const setDialog = useDialogStore((s) => s.setOpen)

  const hasSelection = selectedIds.length > 0

  // Reflect the document name + unsaved state in the browser tab title.
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${documentName} — Ingot CAD`
  }, [dirty, documentName])

  return (
    <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-1">
      <img src="/icon.svg" alt="" className="ml-1 mr-1 h-5 w-5 shrink-0" />
      <span className="mr-2 shrink-0 select-none text-sm font-semibold text-fg-strong">
        Ingot CAD
      </span>

      <Menu label="File">
        <MenuItem onSelect={newProject} shortcut="⌘N">
          New
        </MenuItem>
        <MenuItem onSelect={openProject} shortcut="⌘O">
          Open…
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={saveProject} shortcut="⌘S">
          Save
        </MenuItem>
        <MenuItem onSelect={saveAs} shortcut="⇧⌘S">
          Save As…
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={importStl}>Import STL…</MenuItem>
        <MenuItem
          onSelect={() => void exportStl(useCadStore.getState().doc, projectFilename('stl'))}
        >
          Export STL
        </MenuItem>
        <MenuItem
          onSelect={() => void export3mf(useCadStore.getState().doc, projectFilename('3mf'))}
        >
          Export 3MF
        </MenuItem>
      </Menu>

      <Menu label="Edit">
        <MenuItem onSelect={undo} disabled={!canUndo} shortcut="⌘Z">
          Undo
        </MenuItem>
        <MenuItem onSelect={redo} disabled={!canRedo} shortcut="⇧⌘Z">
          Redo
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => deleteNodes(selectedIds)} disabled={!hasSelection} shortcut="⌫">
          Delete
        </MenuItem>
      </Menu>

      <Menu label="View">
        <MenuLabel>Theme</MenuLabel>
        {THEME_OPTIONS.map((opt) => (
          <MenuItem key={opt.id} onSelect={() => setTheme(opt.id)} checked={theme === opt.id}>
            {opt.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onSelect={() => setGridEnabled(!gridEnabled)} checked={gridEnabled}>
          Show grid
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => setDialog('settings')}>Settings…</MenuItem>
      </Menu>

      <Menu label="Help">
        <MenuItem onSelect={() => setDialog('shortcuts')} shortcut="?">
          Keyboard Shortcuts
        </MenuItem>
        <MenuItem onSelect={() => setDialog('settings')}>About Ingot CAD</MenuItem>
      </Menu>

      <div className="flex-1" />
      <span className="shrink-0 select-none text-sm text-fg-muted">
        {dirty && (
          <span className="mr-1 text-accent" title="Unsaved changes">
            •
          </span>
        )}
        {documentName}
      </span>
      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setDialog('settings')}
        title="Settings"
        className="rounded p-1.5 text-fg-muted hover:bg-elevated hover:text-fg"
      >
        <FontAwesomeIcon icon={faGear} fixedWidth />
      </button>
    </div>
  )
}
