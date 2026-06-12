/**
 * A registry of the rendered root meshes, keyed by node id, so non-R3F code (the
 * "frame selected" shortcut / menu) can read current world bounds. NodeView
 * registers and unregisters its mesh. Only root nodes render a mesh, so a
 * selected child frames its top-level ancestor.
 */
import * as THREE from 'three'
import { useCadStore } from '../document/store'
import type { CadDocument, NodeId } from '../document/types'
import { hasChildren } from '../document/types'
import { useViewportStore } from './viewportStore'

const registry = new Map<NodeId, THREE.Object3D>()

export function registerMesh(id: NodeId, obj: THREE.Object3D | null): void {
  if (obj) registry.set(id, obj)
  else registry.delete(id)
}

/** The rendered root mesh for a node id, if any (local-space geometry). */
export function getMeshObject(id: NodeId): THREE.Object3D | undefined {
  return registry.get(id)
}

/**
 * World-space AABB of every rendered (visible) root mesh, or null when nothing
 * is rendered. Uses the live three.js world matrices, so it reflects each root's
 * current transform without re-evaluating geometry.
 */
export function unionWorldBounds(): THREE.Box3 | null {
  const box = new THREE.Box3()
  let any = false
  for (const obj of registry.values()) {
    const b = new THREE.Box3().setFromObject(obj)
    if (b.isEmpty()) continue
    box.union(b)
    any = true
  }
  return any && !box.isEmpty() ? box : null
}

function parentOf(doc: CadDocument, id: NodeId): NodeId | null {
  for (const n of Object.values(doc.nodes)) {
    if (hasChildren(n) && n.childIds.includes(id)) return n.id
  }
  return null
}

function rootOf(doc: CadDocument, id: NodeId): NodeId {
  let cur = id
  for (let p = parentOf(doc, cur); p; p = parentOf(doc, cur)) cur = p
  return cur
}

function frameRoots(roots: Iterable<NodeId>): void {
  const box = new THREE.Box3()
  let any = false
  for (const rid of roots) {
    const obj = registry.get(rid)
    if (!obj) continue
    const b = new THREE.Box3().setFromObject(obj)
    if (b.isEmpty()) continue
    box.union(b)
    any = true
  }
  if (!any || box.isEmpty()) return
  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  useViewportStore.getState().requestFocus([center.x, center.y, center.z], radius)
}

/** Fly the camera to frame the selection (or the whole scene if nothing is selected). */
export function frameSelected(): void {
  const { selectedIds, doc } = useCadStore.getState()
  frameRoots(
    selectedIds.length > 0 ? new Set(selectedIds.map((id) => rootOf(doc, id))) : doc.rootIds,
  )
}

/** Fly the camera to frame the whole scene, regardless of selection. */
export function frameAll(): void {
  frameRoots(useCadStore.getState().doc.rootIds)
}
