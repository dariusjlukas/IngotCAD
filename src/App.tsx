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
import { MeasureOverlay } from './viewport/MeasureOverlay'
import { SectionPanel } from './viewport/SectionPanel'
import { EdgeTreatmentOverlay } from './viewport/EdgeTreatmentOverlay'
import { toggleMeasure, useMeasureStore } from './viewport/measureStore'
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
import { FaceRefMonitor } from './document/FaceRefMonitor'

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
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        toggleMeasure()
        return
      }
      const vp = useViewportStore.getState()
      const stopMeasure = () => useMeasureStore.getState().cancel()
      if (e.key === 'q' || e.key === 'Q') {
        vp.setTool('select')
        stopMeasure()
      } else if (e.key === 'w' || e.key === 'W') {
        vp.setTool('translate')
        stopMeasure()
      } else if (e.key === 'e' || e.key === 'E') {
        vp.setTool('rotate')
        stopMeasure()
      } else if (e.key === 'r' || e.key === 'R') {
        vp.setTool('scale')
        stopMeasure()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** True if `el` sits inside an active (non-empty) text selection — i.e. the user
 * right-clicked on highlighted text. Used to let the native menu through so copy
 * and browser/extension actions (e.g. "translate selection") stay available.
 * Requiring the target to intersect the selection range keeps a stale selection
 * elsewhere from re-enabling the native menu over the viewport or panels. */
function isOverTextSelection(el: HTMLElement | null): boolean {
  if (!el) return false
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || sel.toString().trim() === '') return false
  return sel.getRangeAt(0).intersectsNode(el)
}

/** Suppress the browser's native right-click menu app-wide, so right-click is
 * consistent everywhere: elements with a custom context menu (outliner,
 * timeline, viewport) show it, and everywhere else shows nothing rather than the
 * OS/browser menu. Custom-menu handlers run first (via React) and open the menu;
 * this listener only adds a harmless extra preventDefault for the rest. Editable
 * fields and highlighted text keep their native menu so right-click
 * cut/copy/paste/spellcheck/translate works. */
function useSuppressNativeContextMenu(): void {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return
      if (isOverTextSelection(el)) return
      e.preventDefault()
    }
    window.addEventListener('contextmenu', onContextMenu)
    return () => window.removeEventListener('contextmenu', onContextMenu)
  }, [])
}

export default function App() {
  const ready = useEngineReady()
  const sketching = useSketchStore((s) => s.active)
  const choosingPlane = useSketchStore((s) => s.choosing)
  // The sketch SVG + scrim track the camera transition, not `active`: dim once the
  // fly-in begins, reveal the canvas only once docked head-on to the plane (so the
  // 2D lines never sit over a moving backdrop), and clear instantly on exit.
  const sketchCamPhase = useViewportStore((s) => s.sketchCamPhase)
  const [leftWidth, setLeftWidth] = useState(224)
  const [rightWidth, setRightWidth] = useState(256)
  useApplyTheme()
  useKeyboardShortcuts()
  useSuppressNativeContextMenu()

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
          {/* Dim the 3D scene behind the sketch so the geometry + projection lines
              read clearly; sits under the sketch SVG (z-10) and passes clicks. */}
          {(sketchCamPhase === 'entering' || sketchCamPhase === 'locked') && (
            <div className="pointer-events-none absolute inset-0 z-[5] bg-sketch-scrim" />
          )}
          {sketchCamPhase === 'locked' && <SketchCanvas />}
          {choosingPlane && <PlanePicker />}
          {!sketching && <PlaneBuilderOverlay />}
          {!sketching && <MeasureOverlay />}
          {!sketching && <EdgeTreatmentOverlay />}
          {!sketching && <SectionPanel />}
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
      <FaceRefMonitor />
    </div>
  )
}
