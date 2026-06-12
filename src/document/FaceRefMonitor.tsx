/**
 * Headless watcher for face-derived planes and face-attached sketches: when the
 * document changes, re-find each FaceRef's source face and flag dependents
 * whose stored snapshot no longer sits on it (moved or missing). Debounced so
 * gizmo releases and scrub edits don't thrash; results go to the transient
 * faceRefStatusStore — the document itself is never auto-rewritten.
 */
import { useEffect } from 'react'
import * as THREE from 'three'
import { useCadStore } from './store'
import type { CadDocument, FaceRef, NodeId, Vec3 } from './types'
import { composeFaceWorld, matchFaceRef, worldMatrixOf, worldPlanesAgree } from './faceRef'
import { setStaleFaceStatuses } from './faceRefStatusStore'
import type { StaleFaceInfo } from './faceRefStatusStore'
import { planarFaceGroups } from '../geometry/edges'
import type { MeshArrays, PlanarFaceGroup } from '../geometry/edges'
import { getMeshObject } from '../viewport/meshRegistry'
import { engine } from '../engine/engine'

const DEBOUNCE_MS = 150

interface Dependent {
  key: string
  label: string
  ref: FaceRef
  /** Stored world snapshot the dependent renders from. */
  snapshot: { normal: Vec3; origin: Vec3 }
}

function collectDependents(doc: CadDocument): Dependent[] {
  const out: Dependent[] = []
  for (const pid of doc.planeOrder) {
    const plane = doc.planes[pid]
    const def = plane?.definition
    if (def?.kind === 'face' && def.source) {
      out.push({
        key: pid,
        label: plane.name,
        ref: def.source,
        snapshot: { normal: def.normal, origin: def.origin },
      })
    }
  }
  for (const node of Object.values(doc.nodes)) {
    if (node.kind !== 'primitive') continue
    const p = node.params
    if ((p.type !== 'extrusion' && p.type !== 'revolution') || !p.sketch?.faceRef) continue
    out.push({
      key: node.id,
      label: node.name,
      ref: p.sketch.faceRef,
      snapshot: { normal: p.sketch.plane.n, origin: p.sketch.plane.origin },
    })
  }
  return out
}

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
  const stale: Record<string, StaleFaceInfo> = {}
  if (deps.length > 0) {
    // Group by source so each source mesh is analyzed once.
    const bySource = new Map<NodeId, Dependent[]>()
    for (const d of deps) bySource.set(d.ref.nodeId, [...(bySource.get(d.ref.nodeId) ?? []), d])

    for (const [sourceId, group] of bySource) {
      const src = doc.nodes[sourceId]
      const mesh = src ? await sourceMeshArrays(doc, sourceId) : null
      let groups: PlanarFaceGroup[] | null = null
      if (mesh) groups = planarFaceGroups(mesh)
      const world = src ? worldMatrixOf(doc, sourceId) : null
      for (const dep of group) {
        if (!src || !groups || !world) {
          stale[dep.key] = { status: 'missing', label: dep.label }
          continue
        }
        const match = matchFaceRef(dep.ref, groups)
        if (match.status === 'missing') {
          stale[dep.key] = { status: 'missing', label: dep.label }
          continue
        }
        const expected = composeFaceWorld(world, match.local)
        if (match.status === 'moved' || !worldPlanesAgree(expected, dep.snapshot)) {
          stale[dep.key] = {
            status: 'moved',
            label: dep.label,
            rebind: {
              origin: expected.point,
              normal: expected.normal,
              localNormal: match.local.normal,
              localOffset: match.local.offset,
            },
          }
        }
      }
    }
  }
  // The doc may have changed while we awaited; only publish if still current.
  if (useCadStore.getState().doc === doc) setStaleFaceStatuses(stale)
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
