/**
 * The top application menu bar (File · Edit · View · Help) plus the document
 * title with an unsaved-changes dot and a quick settings control. App-level
 * commands live here; the toolbar below holds modeling tools only.
 */
import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGear } from '@fortawesome/free-solid-svg-icons'
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu'
import { useDialogStore } from './dialogStore'
import { useCadStore } from '../document/store'
import { selectCanRedo, selectCanUndo } from '../document/selectors'
import { usePrefsStore } from '../preferences/prefsStore'
import type { ThemePreference } from '../preferences/prefsStore'
import { useViewportStore } from '../viewport/viewportStore'
import {
  export3mfFile,
  exportStlFile,
  importStl,
  newProject,
  openProject,
  saveAs,
  saveProject,
} from '../io/commands'

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

/**
 * The center-top document name. Double-click (or the File ▸ Rename… menu item,
 * which drives `editing` from the parent) swaps it for an inline text field that
 * commits on Enter / blur and discards on Escape. The field is uncontrolled so a
 * rename is a single store write, not one per keystroke.
 */
function DocumentTitle({
  name,
  dirty,
  editing,
  onEditingChange,
}: {
  name: string
  dirty: boolean
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const setDocumentName = useCadStore((s) => s.setDocumentName)

  const commit = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && trimmed !== name) setDocumentName(trimmed)
    onEditingChange(false)
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={name}
        aria-label="Document name"
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value)
          else if (e.key === 'Escape') {
            e.currentTarget.value = name // cancel: the impending blur commits nothing
            onEditingChange(false)
          }
        }}
        className="w-48 rounded bg-elevated px-1.5 py-0.5 text-center text-sm text-fg-strong outline-none focus:ring-1 focus:ring-accent-ring"
      />
    )
  }

  return (
    <span
      onDoubleClick={() => onEditingChange(true)}
      title="Double-click to rename"
      className="shrink-0 cursor-text select-none text-sm text-fg-muted"
    >
      {dirty && (
        <span className="mr-1 text-accent" title="Unsaved changes">
          •
        </span>
      )}
      {name}
    </span>
  )
}

export function MenuBar() {
  const documentName = useCadStore((s) => s.documentName)
  const dirty = useCadStore((s) => s.dirty)
  const selectedIds = useCadStore((s) => s.selectedIds)
  const canUndo = useCadStore(selectCanUndo)
  const canRedo = useCadStore(selectCanRedo)

  const undo = useCadStore((s) => s.undo)
  const redo = useCadStore((s) => s.redo)
  const deleteNodes = useCadStore((s) => s.deleteNodes)
  const duplicateNodes = useCadStore((s) => s.duplicateNodes)
  const copyNodes = useCadStore((s) => s.copyNodes)
  const pasteClipboard = useCadStore((s) => s.pasteClipboard)
  const clipboard = useCadStore((s) => s.clipboard)

  const theme = usePrefsStore((s) => s.theme)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const gridEnabled = usePrefsStore((s) => s.gridEnabled)
  const setGridEnabled = usePrefsStore((s) => s.setGridEnabled)
  const smoothShading = usePrefsStore((s) => s.smoothShading)
  const setSmoothShading = usePrefsStore((s) => s.setSmoothShading)
  const projection = usePrefsStore((s) => s.projection)
  const setProjection = usePrefsStore((s) => s.setProjection)
  const setView = useViewportStore((s) => s.setView)

  const setDialog = useDialogStore((s) => s.setOpen)

  const [renaming, setRenaming] = useState(false)

  const hasSelection = selectedIds.length > 0

  // Reflect the document name + unsaved state in the browser tab title.
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${documentName} — Ingot CAD`
  }, [dirty, documentName])

  return (
    <div className="flex items-center gap-1 border-b border-line bg-panel px-2 py-1">
      <img
        src={`${import.meta.env.BASE_URL}icon.svg`}
        alt=""
        className="ml-1 mr-1 h-5 w-5 shrink-0"
      />
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
        <MenuItem onSelect={() => setRenaming(true)}>Rename…</MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={importStl}>Import STL…</MenuItem>
        <MenuItem onSelect={() => void exportStlFile()}>Export STL</MenuItem>
        <MenuItem onSelect={() => void export3mfFile()}>Export 3MF</MenuItem>
      </Menu>

      <Menu label="Edit">
        <MenuItem onSelect={undo} disabled={!canUndo} shortcut="⌘Z">
          Undo
        </MenuItem>
        <MenuItem onSelect={redo} disabled={!canRedo} shortcut="⇧⌘Z">
          Redo
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onSelect={() => duplicateNodes(selectedIds)}
          disabled={!hasSelection}
          shortcut="⌘D"
        >
          Duplicate
        </MenuItem>
        <MenuItem onSelect={() => copyNodes(selectedIds)} disabled={!hasSelection} shortcut="⌘C">
          Copy
        </MenuItem>
        <MenuItem onSelect={() => pasteClipboard()} disabled={!clipboard} shortcut="⌘V">
          Paste
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
        <MenuItem onSelect={() => setSmoothShading(!smoothShading)} checked={smoothShading}>
          Smooth shading
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Camera</MenuLabel>
        <MenuItem
          checked={projection === 'perspective'}
          onSelect={() => setProjection('perspective')}
        >
          Perspective
        </MenuItem>
        <MenuItem
          checked={projection === 'orthographic'}
          onSelect={() => setProjection('orthographic')}
        >
          Orthographic
        </MenuItem>
        <MenuItem onSelect={() => setView([0, 0.001, 1])}>Top view</MenuItem>
        <MenuItem onSelect={() => setView([0, -1, 0])}>Front view</MenuItem>
        <MenuItem onSelect={() => setView([1, 0, 0])}>Right view</MenuItem>
        <MenuItem onSelect={() => setView([1, -1, 1])}>Isometric</MenuItem>
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
      <DocumentTitle
        name={documentName}
        dirty={dirty}
        editing={renaming}
        onEditingChange={setRenaming}
      />
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
