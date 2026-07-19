/**
 * Derives a node's renderable three.js geometry from the document, via the
 * engine. Recomputes ONLY when the subtree's local-space structural hash
 * changes — so moving/rotating/scaling a root (which changes its transform but
 * not its local geometry) never triggers a rebuild, and editing one node never
 * rebuilds its siblings.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as THREE from 'three'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import type { RawMesh } from '../geometry/manifoldToThree'
import { useCadStore } from '../document/store'
import { usePrefsStore } from '../preferences/prefsStore'
import { localHash } from '../engine/hash'

/** Changes closer together than this are treated as an interactive burst. */
const BURST_WINDOW_MS = 300
/** Delay before the full-quality refinement pass after a burst change. */
const REFINE_DELAY_MS = 250

export function useDerivedGeometry(id: string): THREE.BufferGeometry | null {
  const doc = useCadStore((s) => s.doc)
  const smoothShading = usePrefsStore((s) => s.smoothShading)
  const hash = useMemo(() => localHash(doc, id), [doc, id])
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const geoRef = useRef<THREE.BufferGeometry | null>(null)
  const lastChangeRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    const apply = (raw: RawMesh) => {
      if (cancelled) return
      const geo = rawMeshToGeometry(raw, smoothShading)
      geoRef.current?.dispose()
      geoRef.current = geo
      setGeometry(geo)
    }

    // Burst heuristic: when changes arrive in rapid succession, evaluate at
    // draft quality for responsiveness and schedule one full-quality
    // refinement; each new change cancels the previous refinement timer, so
    // exactly one full pass runs after the burst settles. Draft quality must
    // never be used outside this viewport mesh path.
    const now = Date.now()
    const rapid = now - lastChangeRef.current < BURST_WINDOW_MS
    lastChangeRef.current = now

    engine.computeMesh(doc, id, { quality: rapid ? 'draft' : 'full' }).then(apply)
    let refineTimer: ReturnType<typeof setTimeout> | undefined
    if (rapid) {
      refineTimer = setTimeout(() => {
        engine.computeMesh(doc, id, { quality: 'full' }).then(apply)
      }, REFINE_DELAY_MS)
    }
    return () => {
      cancelled = true
      clearTimeout(refineTimer)
    }
    // `doc`/`id` are read fresh inside the closure; rebuild only when the
    // structural hash or the shading mode changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash, smoothShading])

  useEffect(
    () => () => {
      geoRef.current?.dispose()
      geoRef.current = null
    },
    [],
  )

  return geometry
}
