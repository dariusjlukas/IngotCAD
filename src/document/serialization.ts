/**
 * Project file (de)serialization. The document is almost JSON already; the only
 * special handling is mesh assets, whose typed arrays are stored as plain number
 * arrays. `schemaVersion` is the hook for future migrations.
 */
import { SCHEMA_VERSION } from './types'
import type { CadDocument, CadNode, ConstructionPlane, MeshAsset, NodeId } from './types'

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
  planes?: Record<string, ConstructionPlane>
  planeOrder?: string[]
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
    planes: doc.planes,
    planeOrder: doc.planeOrder,
  }
  return JSON.stringify(payload)
}

export function deserializeDocument(text: string): CadDocument {
  const data = JSON.parse(text) as Partial<SerializedDocument>
  if (!data || typeof data !== 'object' || !data.nodes || !Array.isArray(data.rootIds)) {
    throw new Error('Not a valid Ingot project file.')
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
    // Construction planes were added later; default to none.
    planes: data.planes ?? {},
    planeOrder: data.planeOrder ?? [],
  })
}

/** Bring an older document up to the current schema. */
function migrate(doc: CadDocument): CadDocument {
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This project was made with a newer version of Ingot.')
  }
  // v1 → v2: sketch arcs, tangent/radius/angle constraints, edge treatments,
  // and face provenance refs are all *additive* — a v1 document simply lacks
  // them, so the step is an identity. The bump exists so v2 files (which an
  // old build can't represent) are refused by the version gate above.
  doc.schemaVersion = SCHEMA_VERSION
  return doc
}
