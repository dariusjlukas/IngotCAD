import { useEffect, useState } from 'react'
import { MenuBar } from './ui/MenuBar'
import { Toolbar } from './ui/Toolbar'
import { ObjectList } from './ui/ObjectList'
import { PropertyEditor } from './ui/PropertyEditor'
import { ResizeHandle } from './ui/ResizeHandle'
import { StatusBar } from './ui/StatusBar'
import { SettingsDialog } from './ui/SettingsDialog'
import { ShortcutsDialog } from './ui/ShortcutsDialog'
import { Toaster } from './ui/Toaster'
import { ContextMenuHost } from './ui/ContextMenuHost'
import { useDialogStore } from './ui/dialogStore'
import { useContextMenuStore } from './ui/contextMenuStore'
import { frameSelected } from './viewport/meshRegistry'
import { Viewport } from './viewport/Viewport'
import { SketchCanvas } from './sketch/SketchCanvas'
import { SketchProperties, SketchToolbar, SketchToolsPanel } from './sketch/SketchPanels'
import { PlanePicker } from './sketch/PlanePicker'
import { PlaneBuilderOverlay } from './viewport/PlaneBuilderOverlay'
import { OperationConfirm } from './operation/OperationConfirm'
import { Timeline } from './ui/Timeline'
import { engine } from './engine/engine'
import { useCadStore } from './document/store'
import { useViewportStore } from './viewport/viewportStore'
import { useSketchStore } from './sketch/sketchStore'
import { useOperationStore } from './operation/operationStore'
import { useApplyTheme } from './preferences/useResolvedTheme'
import { newProject, openProject, saveAs, saveProject } from './io/commands'
import { restoreAutosave, startAutosave } from './io/autosave'

function useEngineReady(): boolean {
  const [ready, setReady] = useState(engine.isReady())
  useEffect(() => {
    let mounted = true
    engine.ready.then(() => {
      if (mounted) setReady(true)
    })
    return () => {
      mounted = false
    }
  }, [])
  return ready
}

function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      // Sketch mode and the pending-operation preview own the keyboard.
      if (useSketchStore.getState().active) return
      if (useOperationStore.getState().pending) return

      const store = useCadStore.getState()
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) store.redo()
        else store.undo()
        return
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        store.redo()
        return
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (e.shiftKey) saveAs()
        else saveProject()
        return
      }
      if (meta && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        openProject()
        return
      }
      if (meta && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newProject()
        return
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (store.selectedIds.length) store.duplicateNodes(store.selectedIds)
        return
      }
      if (meta && e.key.toLowerCase() === 'c') {
        if (store.selectedIds.length) {
          e.preventDefault()
          store.copyNodes(store.selectedIds)
        }
        return
      }
      if (meta && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        store.pasteClipboard()
        return
      }
      if (e.key === '?') {
        e.preventDefault()
        useDialogStore.getState().setOpen('shortcuts')
        return
      }
      if (e.key === 'Escape') {
        // Let an open dialog/menu handle Escape itself; otherwise deselect.
        if (useDialogStore.getState().open || useContextMenuStore.getState().open) return
        if (store.selectedIds.length || store.selectedPlaneId) {
          e.preventDefault()
          store.clearSelection()
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedPlaneId) {
          e.preventDefault()
          store.deletePlane(store.selectedPlaneId)
        } else if (store.selectedIds.length) {
          e.preventDefault()
          store.deleteNodes(store.selectedIds)
        }
        return
      }
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        frameSelected()
        return
      }
      const vp = useViewportStore.getState()
      if (e.key === 'w' || e.key === 'W') vp.setGizmoMode('translate')
      else if (e.key === 'e' || e.key === 'E') vp.setGizmoMode('rotate')
      else if (e.key === 'r' || e.key === 'R') vp.setGizmoMode('scale')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const ready = useEngineReady()
  const sketching = useSketchStore((s) => s.active)
  const choosingPlane = useSketchStore((s) => s.choosing)
  const [leftWidth, setLeftWidth] = useState(224)
  const [rightWidth, setRightWidth] = useState(256)
  useApplyTheme()
  useKeyboardShortcuts()

  // Restore the last session, then mirror future changes to localStorage.
  useEffect(() => {
    restoreAutosave()
    return startAutosave()
  }, [])

  return (
    <div className="flex h-screen w-screen flex-col bg-surface text-fg">
      {!sketching && <MenuBar />}
      {sketching ? <SketchToolbar /> : <Toolbar />}
      <div className="flex min-h-0 flex-1">
        {sketching ? (
          <SketchToolsPanel />
        ) : (
          <>
            <ObjectList width={leftWidth} />
            <ResizeHandle width={leftWidth} onResize={setLeftWidth} direction={1} />
          </>
        )}
        <div className="relative min-w-0 flex-1">
          {/* The 3D viewport stays mounted (keeps the WebGL context + engine warm);
              the sketch canvas overlays it while sketching. */}
          <Viewport />
          {sketching && <SketchCanvas />}
          {choosingPlane && <PlanePicker />}
          {!sketching && <PlaneBuilderOverlay />}
          <OperationConfirm />
          {!ready && !sketching && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-overlay text-sm text-fg-muted">
              Loading geometry engine…
            </div>
          )}
        </div>
        {sketching ? (
          <SketchProperties />
        ) : (
          <>
            <ResizeHandle width={rightWidth} onResize={setRightWidth} direction={-1} />
            <PropertyEditor width={rightWidth} />
          </>
        )}
      </div>
      {!sketching && <Timeline />}
      <StatusBar />

      <SettingsDialog />
      <ShortcutsDialog />
      <Toaster />
      <ContextMenuHost />
    </div>
  )
}
