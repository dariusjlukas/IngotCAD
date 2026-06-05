/**
 * The geometry engine facade — owns the loaded Manifold module and exposes an
 * async API to the rest of the app.
 *
 * The API is async even though Manifold currently runs on the main thread:
 * hobbyist-scale models evaluate in single-digit to low-tens of milliseconds,
 * and we never recompute during a gizmo drag, so a worker is unnecessary for the
 * MVP. But the async surface means moving evaluation into a Web Worker later is
 * an internal swap with no call-site changes.
 *
 * All Manifold lifecycle lives in `evaluate.ts`; this module never holds a solid
 * handle across an await.
 */
import { loadManifold } from './manifoldModule'
import { computeExportRaw, computeMeshRaw, measureSolid, projectSceneRaw } from './evaluate'
import type { ManifoldToplevel } from 'manifold-3d'
import type { CadDocument, NodeId, Vec2 } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'

class Engine {
  private module: ManifoldToplevel | null = null
  readonly ready: Promise<void>

  constructor() {
    this.ready = loadManifold().then((wasm) => {
      this.module = wasm
    })
  }

  isReady(): boolean {
    return this.module !== null
  }

  /** Local-space geometry for rendering a root node (own transform NOT applied). */
  async computeMesh(doc: CadDocument, id: NodeId): Promise<RawMesh> {
    await this.ready
    return computeMeshRaw(this.module!, doc, id)
  }

  /** World-space union of the given roots, for export to STL/3MF. */
  async computeExportMesh(doc: CadDocument, rootIds: NodeId[]): Promise<RawMesh> {
    await this.ready
    return computeExportRaw(this.module!, doc, rootIds)
  }

  /** Triangle count + volume (mm³) of a subtree, for the status bar. */
  async measure(doc: CadDocument, id: NodeId): Promise<{ triangles: number; volume: number }> {
    await this.ready
    return measureSolid(this.module!, doc, id)
  }

  /** In-plane section outlines of the visible scene, one polygon-group per geometry. */
  async projectScene(
    doc: CadDocument,
    rootIds: NodeId[],
    invMatrix: number[],
  ): Promise<Vec2[][][]> {
    await this.ready
    return projectSceneRaw(this.module!, doc, rootIds, invMatrix)
  }
}

export const engine = new Engine()
