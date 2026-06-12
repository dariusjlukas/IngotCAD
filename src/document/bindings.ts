/**
 * Expression bindings: glue between document variables and numeric node
 * fields. A binding ("nodeId:params.height" → "wall*2") never replaces the
 * stored number — it REWRITES it whenever variables change, so the geometry
 * pipeline (engine, hashing, worker) stays expression-free.
 *
 * Pure helpers operating on a document (or immer draft); the store calls
 * `applyAllBindings` inside the same mutation that edits a variable, so a
 * variable edit plus all its ripple effects is one undo step.
 */
import type { CadDocument, CadNode, NodeId } from './types'
import { evaluateExpression, resolveVariables } from './expressions'

export function bindingKey(nodeId: NodeId, path: string): string {
  return `${nodeId}:${path}`
}

export function parseBindingKey(key: string): { nodeId: NodeId; path: string } | null {
  const i = key.indexOf(':')
  if (i <= 0) return null
  return { nodeId: key.slice(0, i), path: key.slice(i + 1) }
}

/**
 * Write `value` at a dot path ("params.size.0") IF the existing leaf is a
 * number — bindings may go stale after structural edits, and silently creating
 * new properties would corrupt nodes. Returns whether the write happened.
 */
export function setByPath(node: CadNode, path: string, value: number): boolean {
  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = node
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur?.[parts[i]]
    if (cur == null || typeof cur !== 'object') return false
  }
  const leaf = parts[parts.length - 1]
  if (typeof cur?.[leaf] !== 'number') return false
  cur[leaf] = value
  return true
}

/** Read the number at a dot path, or null when the path doesn't resolve. */
export function getByPath(node: CadNode, path: string): number | null {
  const parts = path.split('.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = node
  for (const part of parts) {
    cur = cur?.[part]
    if (cur == null) return null
  }
  return typeof cur === 'number' ? cur : null
}

/**
 * Re-evaluate every binding against the current variables and write the
 * results into the (draft) document. Broken expressions and dangling node ids
 * are skipped — the field keeps its last good number.
 */
export function applyAllBindings(doc: CadDocument): void {
  const keys = Object.keys(doc.bindings)
  if (keys.length === 0) return
  const { values } = resolveVariables(doc.variables)
  for (const key of keys) {
    const parsed = parseBindingKey(key)
    if (!parsed) continue
    const node = doc.nodes[parsed.nodeId]
    if (!node) continue
    let value: number
    try {
      value = evaluateExpression(doc.bindings[key], values)
    } catch {
      continue
    }
    setByPath(node, parsed.path, value)
  }
}

/** Drop bindings owned by deleted nodes (call from the same delete mutation). */
export function pruneBindings(doc: CadDocument, deletedIds: ReadonlySet<NodeId>): void {
  for (const key of Object.keys(doc.bindings)) {
    const parsed = parseBindingKey(key)
    if (parsed && deletedIds.has(parsed.nodeId)) delete doc.bindings[key]
  }
}
