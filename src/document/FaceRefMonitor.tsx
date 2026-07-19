/**
 * Headless associativity monitor: when the document changes, resolve every
 * face-attached dependent against its source's current mesh (resolve.ts) and
 * publish the result — resolved frames to resolvedStore (rendering + exports
 * pick them up) and per-dependent statuses to faceRefStatusStore (badges,
 * bake buttons, and a toast when an attachment loses its face). Debounced so
 * gizmo releases and scrub edits don't thrash; the document itself is never
 * auto-rewritten.
 */
import { useEffect } from 'react'
import * as THREE from 'three'
import { useCadStore } from './store'
import type { CadDocument, NodeId } from './types'
import { collectDependents, resolveDocument } from './resolve'
import { setResolved } from './resolvedStore'
import { setStaleFaceStatuses } from './faceRefStatusStore'
import type { StaleFaceInfo } from './faceRefStatusStore'
import type { MeshArrays } from '../geometry/edges'
import { getMeshObject } from '../viewport/meshRegistry'
import { engine } from '../engine/engine'

const DEBOUNCE_MS = 150

/** Local-space triangle arrays of the source node (rendered mesh, else engine). */
async function sourceMeshArrays(doc: CadDocument, id: NodeId): Promise<MeshArrays | null> {
  const obj = getMeshObject(id)
  if (obj instanceof THREE.Mesh) {
    const pos = obj.geometry.getAttribute('position')
    if (pos) {
      return {
        position: pos.array as ArrayLike<number>,
        index: obj.geometry.index?.array ?? null,
      }
    }
  }
  if (!doc.nodes[id]) return null
  const raw = await engine.computeMesh(doc, id)
  return raw.position.length > 0 ? { position: raw.position, index: raw.index } : null
}

async function check(doc: CadDocument): Promise<void> {
  const deps = collectDependents(doc)
  if (deps.length === 0) {
    if (useCadStore.getState().doc === doc) {
      setResolved({}, [], doc.rootIds)
      setStaleFaceStatuses({})
    }
    return
  }

  // Fetch each source's mesh once (dependent nodes may be sources themselves).
  const sourceIds = [...new Set(deps.map((d) => d.ref.nodeId))]
  const meshes = new Map<NodeId, MeshArrays | null>()
  for (const id of sourceIds) {
    meshes.set(id, doc.nodes[id] ? await sourceMeshArrays(doc, id) : null)
  }
  // The doc may have changed while we awaited; only publish if still current.
  if (useCadStore.getState().doc !== doc) return

  const result = resolveDocument(doc, (id) => meshes.get(id) ?? null)
  setResolved(result.dependents, result.cycles, doc.rootIds)

  const stale: Record<string, StaleFaceInfo> = {}
  for (const dep of Object.values(result.dependents)) {
    if (dep.status === 'missing') {
      stale[dep.key] = { status: 'missing', label: dep.label }
    } else if (dep.status === 'moved' && dep.local) {
      // Auto-followed: no toast, but expose the frame so the property editor
      // can offer a one-click bake ("Rebind") into the document.
      stale[dep.key] = {
        status: 'moved',
        label: dep.label,
        rebind: {
          origin: dep.plane.origin,
          normal: dep.plane.n,
          localNormal: dep.local.normal,
          localOffset: dep.local.offset,
        },
      }
    }
  }
  setStaleFaceStatuses(stale)
}

export function FaceRefMonitor() {
  const doc = useCadStore((s) => s.doc)
  useEffect(() => {
    const t = setTimeout(() => {
      void check(doc)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [doc])
  return null
}
