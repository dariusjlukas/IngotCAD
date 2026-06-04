/**
 * Project file (de)serialization. The document is almost JSON already; the only
 * special handling is mesh assets, whose typed arrays are stored as plain number
 * arrays. `schemaVersion` is the hook for future migrations.
 */
import { SCHEMA_VERSION } from './types'
import type { CadDocument, CadNode, MeshAsset, NodeId } from './types'

interface SerializedAsset {
  position: number[]
  index: number[]
}

interface SerializedDocument {
  schemaVersion: number
  units: 'mm'
  nodes: Record<NodeId, CadNode>
  rootIds: NodeId[]
  assets: Record<string, SerializedAsset>
  featureOrder?: NodeId[]
}

export function serializeDocument(doc: CadDocument): string {
  const assets: Record<string, SerializedAsset> = {}
  for (const [key, asset] of Object.entries(doc.assets)) {
    assets[key] = { position: Array.from(asset.position), index: Array.from(asset.index) }
  }
  const payload: SerializedDocument = {
    schemaVersion: doc.schemaVersion,
    units: 'mm',
    nodes: doc.nodes,
    rootIds: doc.rootIds,
    assets,
    featureOrder: doc.featureOrder,
  }
  return JSON.stringify(payload)
}

export function deserializeDocument(text: string): CadDocument {
  const data = JSON.parse(text) as Partial<SerializedDocument>
  if (!data || typeof data !== 'object' || !data.nodes || !Array.isArray(data.rootIds)) {
    throw new Error('Not a valid Hobby CAD project file.')
  }

  const assets: Record<string, MeshAsset> = {}
  for (const [key, asset] of Object.entries(data.assets ?? {})) {
    assets[key] = {
      position: new Float32Array(asset.position),
      index: new Uint32Array(asset.index),
    }
  }

  return migrate({
    schemaVersion: data.schemaVersion ?? 1,
    units: 'mm',
    nodes: data.nodes,
    rootIds: data.rootIds,
    assets,
    // Older files lack featureOrder; fall back to node insertion order.
    featureOrder: data.featureOrder ?? Object.keys(data.nodes),
  })
}

/** Bring an older document up to the current schema. (No migrations yet.) */
function migrate(doc: CadDocument): CadDocument {
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This project was made with a newer version of Hobby CAD.')
  }
  // Future: step the document up one version at a time here.
  doc.schemaVersion = SCHEMA_VERSION
  return doc
}
