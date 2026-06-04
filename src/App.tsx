import { useEffect, useState } from 'react'
import { Toolbar } from './ui/Toolbar'
import { ObjectList } from './ui/ObjectList'
import { PropertyEditor } from './ui/PropertyEditor'
import { StatusBar } from './ui/StatusBar'
import { Viewport } from './viewport/Viewport'
import { SketchCanvas } from './sketch/SketchCanvas'
import { SketchProperties, SketchToolbar, SketchToolsPanel } from './sketch/SketchPanels'
import { engine } from './engine/engine'
import { useCadStore } from './document/store'
import { useViewportStore } from './viewport/viewportStore'
import { useSketchStore } from './sketch/sketchStore'

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
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      // Sketch mode owns the keyboard (Esc/Enter/Backspace) while active.
      if (useSketchStore.getState().active) return

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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (store.selectedIds.length) {
          e.preventDefault()
          store.deleteNodes(store.selectedIds)
        }
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
  useKeyboardShortcuts()

  return (
    <div className="flex h-screen w-screen flex-col bg-neutral-950 text-neutral-200">
      {sketching ? <SketchToolbar /> : <Toolbar />}
      <div className="flex min-h-0 flex-1">
        {sketching ? <SketchToolsPanel /> : <ObjectList />}
        <div className="relative min-w-0 flex-1">
          {/* The 3D viewport stays mounted (keeps the WebGL context + engine warm);
              the sketch canvas overlays it while sketching. */}
          <Viewport />
          {sketching && <SketchCanvas />}
          {!ready && !sketching && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-neutral-950/60 text-sm text-neutral-300">
              Loading geometry engine…
            </div>
          )}
        </div>
        {sketching ? <SketchProperties /> : <PropertyEditor />}
      </div>
      <StatusBar />
    </div>
  )
}
