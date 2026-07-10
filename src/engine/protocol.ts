/**
 * Wire types for the engine Web Worker. Everything here must be
 * structured-clonable: plain objects and typed arrays only.
 *
 * Documents cross the boundary as a `WireDocument`: the (potentially large,
 * immutable) mesh assets are stripped to their ids, and only assets the worker
 * has not yet cached are inlined. The worker replies `missing-assets` if it is
 * asked to evaluate with an asset id it does not have (e.g. after a respawn),
 * and the client retries with those assets inlined.
 */
import type { CadDocument, MeshAsset, NodeId, Vec2 } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'

export interface WireDocument extends Omit<CadDocument, 'assets'> {
  /** Every asset id the document holds; the worker fills them from its cache. */
  assetIds: string[]
  /** Assets the client believes the worker does not have yet. */
  inlineAssets: Record<string, MeshAsset>
}

/** Non-fatal problems found while evaluating (e.g. an edge treatment whose
 * picked edge no longer exists). Carried on every result so the UI can badge
 * the offending nodes. */
export type EvalWarningCode = 'edge-unmatched' | 'edge-too-large'

export interface EvalWarning {
  nodeId: NodeId
  code: EvalWarningCode
  /** The EdgeTreatmentEntry id the warning refers to (when applicable). */
  entryId: string
  message: string
}

export type EngineRequest =
  | { id: number; method: 'computeMesh'; doc: WireDocument; nodeId: NodeId }
  | { id: number; method: 'computeExportMesh'; doc: WireDocument; rootIds: NodeId[] }
  | { id: number; method: 'measure'; doc: WireDocument; nodeId: NodeId }
  | {
      id: number
      method: 'projectScene'
      doc: WireDocument
      rootIds: NodeId[]
      invMatrix: number[]
    }

export interface MeasureInfo {
  triangles: number
  volume: number
}

export type EngineResult = RawMesh | MeasureInfo | Vec2[][][]

export type EngineResponse =
  | { type: 'ready' }
  /** The worker's WASM module failed to load (e.g. fetch 404, OOM) — it will
   * never become ready and answers every request with an `error`. */
  | { type: 'load-error'; message: string }
  | { type: 'result'; id: number; result: EngineResult; warnings: EvalWarning[] }
  | { type: 'error'; id: number; message: string }
  | { type: 'missing-assets'; id: number; assetIds: string[] }

/**
 * Transfer list for posting a `RawMesh` across the worker boundary. Real meshes
 * transfer their buffers (zero-copy fast path). Zero-length buffers are omitted:
 * failed/empty evaluations return the shared `EMPTY_MESH` singleton, and
 * transferring its buffers would detach them, making every later post of the
 * singleton throw DataCloneError. A buffer shared by both views is listed once
 * (transferring the same buffer twice also throws).
 */
export function rawMeshTransferList(raw: RawMesh): Transferable[] {
  const transfer: Transferable[] = []
  if (raw.position.buffer.byteLength > 0) transfer.push(raw.position.buffer)
  if (raw.index.buffer.byteLength > 0 && raw.index.buffer !== raw.position.buffer) {
    transfer.push(raw.index.buffer)
  }
  return transfer
}

/**
 * Strip a document for the wire. `knownAssetIds` is the client's record of what
 * the worker has cached; assets outside it are inlined (and structured-cloned by
 * postMessage — never transferred, the document still owns its buffers).
 */
export function toWireDocument(doc: CadDocument, knownAssetIds: ReadonlySet<string>): WireDocument {
  const { assets, ...rest } = doc
  const assetIds = Object.keys(assets)
  const inlineAssets: Record<string, MeshAsset> = {}
  for (const id of assetIds) {
    if (!knownAssetIds.has(id)) inlineAssets[id] = assets[id]
  }
  return { ...rest, assetIds, inlineAssets }
}

/** Rebuild a full document on the worker side from the wire form + asset cache. */
export function fromWireDocument(
  wire: WireDocument,
  cache: ReadonlyMap<string, MeshAsset>,
): CadDocument {
  const rest: Partial<WireDocument> = { ...wire }
  delete rest.assetIds
  delete rest.inlineAssets
  const assets: Record<string, MeshAsset> = {}
  for (const id of wire.assetIds) {
    const asset = cache.get(id)
    if (asset) assets[id] = asset
  }
  return { ...(rest as Omit<CadDocument, 'assets'>), assets }
}
