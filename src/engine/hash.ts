/**
 * Structural hashing of a node subtree.
 *
 * The performance spine of the app: geometry is recomputed (and cached) keyed
 * by a content hash of the subtree, so editing one leaf invalidates only its
 * ancestor chain — siblings and unrelated roots are cache hits.
 *
 * Two flavours:
 *  - `localHash`  — the geometry of a node *in its own local space* (params /
 *    op / children, but NOT the node's own transform). This is what the
 *    rendered geometry of a root depends on, because a root's own transform is
 *    applied to the three.js mesh, not baked into the geometry. Moving a root
 *    therefore never recomputes geometry.
 *  - `fullHash`   — `localHash` plus the node's own transform and role. This is
 *    what a *parent* depends on, since a child's transform and role are baked
 *    into the parent's combined geometry.
 *
 * Hashes are compact canonical strings; equal strings ⇒ identical geometry.
 */
import type { CadDocument, NodeId } from '../document/types'

function t(n: number): string {
  // Quantize to kill floating-point noise that would otherwise bust the cache
  // for visually identical values.
  return (Math.round(n * 1e6) / 1e6).toString()
}

export function fullHash(doc: CadDocument, id: NodeId): string {
  const node = doc.nodes[id]
  if (!node) return '∅'
  const tr = node.transform
  const transform = `${t(tr.position[0])},${t(tr.position[1])},${t(tr.position[2])};${t(
    tr.rotationDeg[0],
  )},${t(tr.rotationDeg[1])},${t(tr.rotationDeg[2])};${t(tr.scale[0])},${t(tr.scale[1])},${t(
    tr.scale[2],
  )}`
  return `${localHash(doc, id)}@${transform}#${node.role}`
}

export function localHash(doc: CadDocument, id: NodeId): string {
  const node = doc.nodes[id]
  if (!node) return '∅'
  switch (node.kind) {
    case 'primitive':
      return `P:${JSON.stringify(node.params)}`
    case 'group':
      return `G:[${node.childIds.map((c) => fullHash(doc, c)).join(',')}]`
    case 'boolean':
      return `B:${node.op}:[${node.childIds.map((c) => fullHash(doc, c)).join(',')}]`
    case 'pattern':
      return `PAT:${JSON.stringify(node.spec)}:[${node.childIds
        .map((c) => fullHash(doc, c))
        .join(',')}]`
    case 'shell':
      // Evaluation branches discontinuously at thickness <= 0 (no shell at
      // all), so that state must hash distinctly — t() alone would collapse
      // every |thickness| < 5e-7 to '0' and serve stale geometry across the
      // boundary.
      return `SH:${node.thickness > 0 ? t(node.thickness) : 'off'},${node.openTop ? 1 : 0}:[${node.childIds
        .map((c) => fullHash(doc, c))
        .join(',')}]`
    case 'edgeTreatment':
      return `ET:${JSON.stringify(node.entries)}:[${node.childIds
        .map((c) => fullHash(doc, c))
        .join(',')}]`
  }
}
