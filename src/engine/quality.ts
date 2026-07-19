/**
 * Quality tiers for mesh evaluation. `draft` halves the tessellation of the
 * segment-count-driven primitives so interactive edits (dimension drags, burst
 * typing) evaluate fast; the full-quality result replaces it once the burst
 * settles. Draft quality is ONLY for the viewport mesh path — exports,
 * measures, projections, and section views always evaluate at full quality.
 */
import type { CadDocument, CadNode, NodeId, PrimitiveParams } from '../document/types'

export type MeshQuality = 'draft' | 'full'

/** Draft tessellation never drops below this many segments. */
const MIN_DRAFT_SEGMENTS = 8

/** Reduced params for draft evaluation, or null if the params are unaffected. */
function draftParams(params: PrimitiveParams): PrimitiveParams | null {
  if (params.type !== 'cylinder' && params.type !== 'sphere' && params.type !== 'revolution') {
    return null
  }
  const segments = Math.max(MIN_DRAFT_SEGMENTS, Math.round(params.segments / 2))
  if (segments === params.segments) return null
  return { ...params, segments }
}

/**
 * Return a document whose segment-driven primitives are re-tessellated for
 * draft quality. The input is treated as immutable: only the nodes that change
 * are copied (everything else is shared by reference), and if nothing changes
 * the input document itself is returned.
 */
export function applyDraftQuality(doc: CadDocument): CadDocument {
  let nodes: Record<NodeId, CadNode> | null = null
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'primitive') continue
    const params = draftParams(node.params)
    if (params === null) continue
    if (nodes === null) nodes = { ...doc.nodes }
    nodes[id] = { ...node, params }
  }
  if (nodes === null) return doc
  return { ...doc, nodes }
}
