/**
 * Main-thread client for the engine Web Worker.
 *
 * Responsibilities:
 * - request/response correlation (numeric ids)
 * - per-key latest-wins coalescing (RequestQueue): superseded geometry requests
 *   for the same node are never posted; displaced callers resolve with the
 *   newest result (all current callers tag/guard results, so this is safe)
 * - asset sync: each mesh asset is structured-cloned to the worker once, then
 *   referenced by id; a `missing-assets` reply (e.g. after a respawn) triggers
 *   one retry with the assets inlined
 * - busy-state bookkeeping for the status bar (engineStatusStore)
 * - crash recovery: reject in-flight work, respawn the worker, toast the user
 */
import { RequestQueue } from './requestQueue'
import { toWireDocument } from './protocol'
import type {
  EngineRequest,
  EngineResponse,
  EngineResult,
  EvalWarning,
  MeasureInfo,
} from './protocol'
import { jobFinished, jobStarted } from './engineStatusStore'
import { setEvalWarnings } from './evalWarningsStore'
import { toast } from '../ui/toastStore'
import type { CadDocument, DistributiveOmit, NodeId, Vec2 } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'

interface InFlight {
  resolve: (result: EngineResult, warnings: EvalWarning[]) => void
  reject: (err: Error) => void
  /** The original document, retained for a missing-assets retry. */
  doc: CadDocument
  request: EngineRequest
  retried: boolean
}

export class EngineWorkerClient {
  readonly ready: Promise<void>
  private worker!: Worker
  private resolveReady!: () => void
  private nextId = 1
  private inFlight = new Map<number, InFlight>()
  private knownAssetIds = new Set<string>()
  private queue = new RequestQueue()

  constructor() {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve
    })
    this.spawn()
  }

  computeMesh(doc: CadDocument, id: NodeId): Promise<RawMesh> {
    return this.queue.submit(`mesh:${id}`, () =>
      this.call<RawMesh>({ method: 'computeMesh', nodeId: id }, doc, id),
    )
  }

  computeExportMesh(doc: CadDocument, rootIds: NodeId[]): Promise<RawMesh> {
    // Exports are explicit user actions — never coalesced away.
    return this.queue.submit(null, () =>
      this.call<RawMesh>({ method: 'computeExportMesh', rootIds }, doc),
    )
  }

  measure(doc: CadDocument, id: NodeId): Promise<MeasureInfo> {
    return this.queue.submit(`measure:${id}`, () =>
      this.call<MeasureInfo>({ method: 'measure', nodeId: id }, doc),
    )
  }

  projectScene(doc: CadDocument, rootIds: NodeId[], invMatrix: number[]): Promise<Vec2[][][]> {
    return this.queue.submit('projectScene', () =>
      this.call<Vec2[][][]>({ method: 'projectScene', rootIds, invMatrix }, doc),
    )
  }

  /**
   * Post one request and settle its promise from the matching response. When
   * `warningsRoot` is given, the response's warnings are published to the
   * eval-warnings store under that root id.
   */
  private call<T extends EngineResult>(
    partial: DistributiveOmit<EngineRequest, 'id' | 'doc'>,
    doc: CadDocument,
    warningsRoot?: NodeId,
  ): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((outerResolve, outerReject) => {
      const request = {
        ...partial,
        id,
        doc: toWireDocument(doc, this.knownAssetIds),
      } as EngineRequest
      for (const assetId of request.doc.assetIds) this.knownAssetIds.add(assetId)
      this.inFlight.set(id, {
        resolve: (result, warnings) => {
          jobFinished()
          if (warningsRoot !== undefined) setEvalWarnings(warningsRoot, warnings)
          outerResolve(result as T)
        },
        reject: (err) => {
          jobFinished()
          outerReject(err)
        },
        doc,
        request,
        retried: false,
      })
      jobStarted()
      this.worker.postMessage(request)
    })
  }

  private onMessage = (ev: MessageEvent<EngineResponse>) => {
    const msg = ev.data
    if (msg.type === 'ready') {
      this.resolveReady()
      return
    }
    if (msg.type === 'load-error') {
      // The worker's WASM failed to load and will never post 'ready'. Unblock
      // `ready` so callers reach the worker and settle with per-request errors
      // instead of hanging forever behind an unresolved ready promise.
      toast.error(`Geometry engine failed to load: ${msg.message}`)
      this.resolveReady()
      return
    }
    const job = this.inFlight.get(msg.id)
    if (!job) return
    if (msg.type === 'missing-assets') {
      if (job.retried) {
        this.inFlight.delete(msg.id)
        job.reject(new Error(`Engine worker is missing assets: ${msg.assetIds.join(', ')}`))
        return
      }
      // Re-post with the missing assets inlined (they fell out of the worker's
      // cache, e.g. after a respawn).
      job.retried = true
      for (const assetId of msg.assetIds) this.knownAssetIds.delete(assetId)
      const retry = {
        ...job.request,
        doc: toWireDocument(job.doc, this.knownAssetIds),
      } as EngineRequest
      for (const assetId of retry.doc.assetIds) this.knownAssetIds.add(assetId)
      job.request = retry
      this.worker.postMessage(retry)
      return
    }
    this.inFlight.delete(msg.id)
    if (msg.type === 'error') {
      job.reject(new Error(msg.message))
    } else {
      job.resolve(msg.result, msg.warnings)
    }
  }

  private onError = (ev: ErrorEvent) => {
    // The worker is gone (e.g. WASM OOM). Fail everything in flight and start a
    // fresh worker; its asset cache starts empty, so knownAssetIds resets too.
    const err = new Error(`Engine worker crashed: ${ev.message || 'unknown error'}`)
    for (const job of this.inFlight.values()) job.reject(err)
    this.inFlight.clear()
    this.knownAssetIds.clear()
    this.worker.terminate()
    toast.error('Geometry engine crashed — restarting it.')
    this.spawn()
  }

  private spawn(): void {
    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = this.onMessage
    this.worker.onerror = this.onError
  }
}
