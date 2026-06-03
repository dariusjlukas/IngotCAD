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
import { useCadStore } from '../document/store'
import { localHash } from '../engine/hash'

export function useDerivedGeometry(id: string): THREE.BufferGeometry | null {
  const doc = useCadStore((s) => s.doc)
  const hash = useMemo(() => localHash(doc, id), [doc, id])
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null)
  const geoRef = useRef<THREE.BufferGeometry | null>(null)

  useEffect(() => {
    let cancelled = false
    engine.computeMesh(doc, id).then((raw) => {
      if (cancelled) return
      const geo = rawMeshToGeometry(raw)
      geoRef.current?.dispose()
      geoRef.current = geo
      setGeometry(geo)
    })
    return () => {
      cancelled = true
    }
    // `doc`/`id` are read fresh inside the closure; only `hash` should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash])

  useEffect(
    () => () => {
      geoRef.current?.dispose()
      geoRef.current = null
    },
    [],
  )

  return geometry
}
