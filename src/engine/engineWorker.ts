/**
 * The engine Web Worker: owns its Manifold WASM instance and runs all geometry
 * evaluation off the main thread. A dumb serial request/response loop — all
 * coalescing/backpressure lives in the client (workerClient.ts).
 *
 * Mesh assets are cached here by id (assets are immutable per id; imports get
 * fresh ids), so a large imported STL crosses the boundary once per session,
 * not once per evaluation. If a request references an uncached asset (e.g.
 * after a worker respawn), the worker replies `missing-assets` and the client
 * retries with the assets inlined.
 */
import { loadManifold } from './manifoldModule'
import { computeExportRaw, computeMeshRaw, measureSolid, projectSceneRaw } from './evaluate'
import { fromWireDocument } from './protocol'
import type { EngineRequest, EngineResponse, EvalWarning } from './protocol'
import type { MeshAsset } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'

const assetCache = new Map<string, MeshAsset>()

const ready = loadManifold().then((wasm) => {
  post({ type: 'ready' })
  return wasm
})

function post(msg: EngineResponse, transfer: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(msg, transfer)
}

function postMesh(id: number, raw: RawMesh, warnings: EvalWarning[]): void {
  post({ type: 'result', id, result: raw, warnings }, [raw.position.buffer, raw.index.buffer])
}

self.onmessage = async (ev: MessageEvent<EngineRequest>) => {
  const req = ev.data
  // The only await; after it the handler is synchronous, so requests are
  // processed strictly in arrival order even though the handler is async.
  const M = await ready

  for (const [id, asset] of Object.entries(req.doc.inlineAssets)) {
    assetCache.set(id, asset)
  }
  const missing = req.doc.assetIds.filter((id) => !assetCache.has(id))
  if (missing.length > 0) {
    post({ type: 'missing-assets', id: req.id, assetIds: missing })
    return
  }

  const doc = fromWireDocument(req.doc, assetCache)
  const warnings: EvalWarning[] = []
  const warn = (w: EvalWarning) => warnings.push(w)
  try {
    switch (req.method) {
      case 'computeMesh':
        postMesh(req.id, computeMeshRaw(M, doc, req.nodeId, warn), warnings)
        break
      case 'computeExportMesh':
        postMesh(req.id, computeExportRaw(M, doc, req.rootIds, warn), warnings)
        break
      case 'measure':
        post({ type: 'result', id: req.id, result: measureSolid(M, doc, req.nodeId), warnings })
        break
      case 'projectScene':
        post({
          type: 'result',
          id: req.id,
          result: projectSceneRaw(M, doc, req.rootIds, req.invMatrix),
          warnings,
        })
        break
    }
  } catch (err) {
    post({ type: 'error', id: req.id, message: err instanceof Error ? err.message : String(err) })
  }
}
