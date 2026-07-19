/**
 * The geometry engine facade — exposes an async API to the rest of the app and
 * hides where evaluation actually runs.
 *
 * In the browser, evaluation runs in a dedicated Web Worker (workerClient.ts /
 * engineWorker.ts): the main thread stays responsive during slow booleans, and
 * superseded requests for the same node are coalesced latest-wins. Note the
 * coalescing contract: a superseded `computeMesh` promise resolves with the
 * NEWEST result for that node — all callers already tag results / guard with
 * cancelled flags, so stale resolutions are discarded at the call site.
 *
 * Outside the browser (vitest, node), evaluation runs in-process on a directly
 * loaded Manifold module — same code path the worker uses (evaluate.ts).
 */
import { loadManifold } from './manifoldModule'
import { computeExportRaw, computeMeshRaw, measureSolid, projectSceneRaw } from './evaluate'
import { EngineWorkerClient } from './workerClient'
import { setEvalWarnings } from './evalWarningsStore'
import { applyDraftQuality } from './quality'
import type { MeshQuality } from './quality'
import type { EvalWarning } from './protocol'
import { EMPTY_MESH } from '../geometry/manifoldToThree'
import type { ManifoldToplevel } from 'manifold-3d'
import type { CadDocument, NodeId, Transform, Vec2 } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'

interface EngineBackend {
  ready: Promise<void>
  computeMesh(doc: CadDocument, id: NodeId, opts?: { quality?: MeshQuality }): Promise<RawMesh>
  computeExportMesh(
    doc: CadDocument,
    rootIds: NodeId[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<RawMesh>
  measure(doc: CadDocument, id: NodeId): Promise<{ triangles: number; volume: number }>
  projectScene(
    doc: CadDocument,
    rootIds: NodeId[],
    invMatrix: number[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<Vec2[][][]>
}

/** In-process backend: Manifold on the calling thread (tests / no-Worker envs). */
class LocalBackend implements EngineBackend {
  private module: ManifoldToplevel | null = null
  readonly ready: Promise<void>

  constructor() {
    this.ready = loadManifold().then((wasm) => {
      this.module = wasm
    })
  }

  async computeMesh(
    doc: CadDocument,
    id: NodeId,
    opts?: { quality?: MeshQuality },
  ): Promise<RawMesh> {
    await this.ready
    const evalDoc = opts?.quality === 'draft' ? applyDraftQuality(doc) : doc
    const warnings: EvalWarning[] = []
    const raw = computeMeshRaw(this.module!, evalDoc, id, (w) => warnings.push(w))
    setEvalWarnings(id, warnings)
    return raw
  }

  async computeExportMesh(
    doc: CadDocument,
    rootIds: NodeId[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<RawMesh> {
    await this.ready
    return computeExportRaw(this.module!, doc, rootIds, undefined, overrides)
  }

  async measure(doc: CadDocument, id: NodeId): Promise<{ triangles: number; volume: number }> {
    await this.ready
    return measureSolid(this.module!, doc, id)
  }

  async projectScene(
    doc: CadDocument,
    rootIds: NodeId[],
    invMatrix: number[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<Vec2[][][]> {
    await this.ready
    return projectSceneRaw(this.module!, doc, rootIds, invMatrix, overrides)
  }
}

class Engine {
  private backend: EngineBackend
  readonly ready: Promise<void>
  private isReadyFlag = false

  constructor() {
    const canUseWorker = typeof window !== 'undefined' && typeof Worker === 'function'
    this.backend = canUseWorker ? new EngineWorkerClient() : new LocalBackend()
    this.ready = this.backend.ready.then(() => {
      this.isReadyFlag = true
    })
  }

  isReady(): boolean {
    return this.isReadyFlag
  }

  /**
   * Local-space geometry for rendering a root node (own transform NOT applied).
   * `quality: 'draft'` evaluates with reduced tessellation for interactive
   * bursts; it must ONLY be used for viewport meshes — exports, measures, and
   * projections always run at full quality.
   */
  async computeMesh(
    doc: CadDocument,
    id: NodeId,
    opts?: { quality?: MeshQuality },
  ): Promise<RawMesh> {
    await this.ready
    // Rendering callers historically never saw a rejection (evaluation errors
    // resolve to an empty mesh); preserve that for worker failures too.
    return this.backend.computeMesh(doc, id, opts).catch((err: unknown) => {
      console.error('computeMesh failed', err)
      return EMPTY_MESH
    })
  }

  /** World-space union of the given roots, for export to STL/3MF. `overrides`
   * carries the resolved placement of auto-following face-attached nodes so
   * the exported part matches the viewport. */
  async computeExportMesh(
    doc: CadDocument,
    rootIds: NodeId[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<RawMesh> {
    await this.ready
    // Exports propagate errors — the file commands surface them as toasts.
    return this.backend.computeExportMesh(doc, rootIds, overrides)
  }

  /** Triangle count + volume (mm³) of a subtree, for the status bar. */
  async measure(doc: CadDocument, id: NodeId): Promise<{ triangles: number; volume: number }> {
    await this.ready
    return this.backend.measure(doc, id).catch((err: unknown) => {
      console.error('measure failed', err)
      return { triangles: 0, volume: 0 }
    })
  }

  /** In-plane section outlines of the visible scene, one polygon-group per geometry. */
  async projectScene(
    doc: CadDocument,
    rootIds: NodeId[],
    invMatrix: number[],
    overrides?: Record<NodeId, Transform>,
  ): Promise<Vec2[][][]> {
    await this.ready
    return this.backend.projectScene(doc, rootIds, invMatrix, overrides).catch((err: unknown) => {
      console.error('projectScene failed', err)
      return []
    })
  }
}

export const engine = new Engine()
