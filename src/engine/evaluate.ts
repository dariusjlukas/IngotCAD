/**
 * Pure Manifold evaluation: given an already-loaded Manifold module, turn a CAD
 * document (sub)tree into solids and raw triangle data. No knowledge of how the
 * module was loaded (browser `?url` vs Node), so this is unit-testable directly.
 *
 * This module is the sole owner of Manifold object lifecycles: every
 * intermediate solid it allocates is deleted before returning, and callers must
 * delete the final solid (the compute* helpers do this for you).
 *
 * Evaluation model — each node's `transform` is relative to its parent:
 *  - `evaluate(id)`      → solid in the PARENT's space (own transform applied)
 *  - `evaluateLocal(id)` → solid in the node's OWN space (own transform not
 *                          applied). Rendering uses this for a root and applies
 *                          the root's transform to the three.js mesh, so moving
 *                          a root never rebuilds geometry.
 */
import type { ManifoldToplevel, Manifold, Mat4 } from 'manifold-3d'
import type { BooleanOp, CadDocument, NodeId, PrimitiveParams, Role, Vec2 } from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'
import { EMPTY_MESH } from '../geometry/manifoldToThree'
import { isIdentityTransform, transformToMat4Array } from '../geometry/transform'

type Wasm = ManifoldToplevel

interface RoledSolid {
  role: Role
  solid: Manifold
}

function emptySolid(M: Wasm): Manifold {
  // A zero-extent cube is an empty manifold — a safe neutral element.
  return M.Manifold.cube([0, 0, 0], true)
}

function buildPrimitive(M: Wasm, doc: CadDocument, params: PrimitiveParams): Manifold {
  switch (params.type) {
    case 'box':
      return M.Manifold.cube(params.size, true)
    case 'cylinder':
      return M.Manifold.cylinder(
        params.height,
        params.radiusBottom,
        params.radiusTop,
        params.segments,
        true,
      )
    case 'sphere':
      return M.Manifold.sphere(params.radius, params.segments)
    case 'mesh':
      return buildMeshPrimitive(M, doc, params.assetId)
    case 'extrusion':
      return buildExtrusion(M, params.profile, params.height)
  }
}

function buildExtrusion(M: Wasm, profile: Vec2[][], height: number): Manifold {
  if (profile.length === 0 || height <= 0) return emptySolid(M)
  // CrossSection unions the contours (Positive fill rule); extrude centered on Z
  // so the solid behaves like the other origin-centered primitives.
  const cross = new M.CrossSection(profile, 'Positive')
  const solid = cross.extrude(height, 0, 0, undefined, true)
  cross.delete()
  return solid
}

function buildMeshPrimitive(M: Wasm, doc: CadDocument, assetId: string): Manifold {
  const asset = doc.assets[assetId]
  if (!asset) return emptySolid(M)
  const mesh = new M.Mesh({
    numProp: 3,
    vertProperties: asset.position,
    triVerts: asset.index,
  })
  // STL meshes have per-triangle duplicated verts; weld them so the result can
  // be a watertight manifold.
  mesh.merge()
  return M.Manifold.ofMesh(mesh)
}

/** Union a list of solids, consuming the inputs unless there is exactly one. */
function unionAll(M: Wasm, solids: Manifold[]): Manifold {
  if (solids.length === 0) return emptySolid(M)
  if (solids.length === 1) return solids[0]
  const result = M.Manifold.union(solids)
  solids.forEach((s) => s.delete())
  return result
}

function combineGroup(M: Wasm, children: RoledSolid[]): Manifold {
  const solids = children.filter((c) => c.role === 'solid').map((c) => c.solid)
  const holes = children.filter((c) => c.role === 'hole').map((c) => c.solid)
  let base = unionAll(M, solids)
  if (holes.length > 0) {
    const cut = unionAll(M, holes)
    const result = base.subtract(cut)
    base.delete()
    cut.delete()
    base = result
  }
  return base
}

function combineBoolean(M: Wasm, solids: Manifold[], op: BooleanOp): Manifold {
  if (solids.length === 1) return solids[0]
  if (op === 'union') return unionAll(M, solids)
  if (op === 'intersect') {
    const result = M.Manifold.intersection(solids)
    solids.forEach((s) => s.delete())
    return result
  }
  // subtract: first minus the union of the rest
  const [first, ...rest] = solids
  const cut = unionAll(M, rest)
  const result = first.subtract(cut)
  first.delete()
  cut.delete()
  return result
}

export function evaluateLocal(M: Wasm, doc: CadDocument, id: NodeId): Manifold {
  const node = doc.nodes[id]
  if (!node) throw new Error(`Unknown node: ${id}`)
  if (node.kind === 'primitive') return buildPrimitive(M, doc, node.params)

  const children: RoledSolid[] = node.childIds
    .filter((cid) => doc.nodes[cid])
    .map((cid) => ({ role: doc.nodes[cid].role, solid: evaluate(M, doc, cid) }))

  if (children.length === 0) return emptySolid(M)
  if (node.kind === 'group') return combineGroup(M, children)
  return combineBoolean(M, children.map((c) => c.solid), node.op)
}

export function evaluate(M: Wasm, doc: CadDocument, id: NodeId): Manifold {
  const local = evaluateLocal(M, doc, id)
  const tr = doc.nodes[id].transform
  if (isIdentityTransform(tr)) return local
  const result = local.transform(transformToMat4Array(tr) as unknown as Mat4)
  local.delete()
  return result
}

function meshToRaw(mesh: {
  numProp: number
  vertProperties: Float32Array
  triVerts: Uint32Array
}): RawMesh {
  const { numProp, vertProperties, triVerts } = mesh
  let position: Float32Array
  if (numProp === 3) {
    position = new Float32Array(vertProperties)
  } else {
    const vertCount = vertProperties.length / numProp
    position = new Float32Array(vertCount * 3)
    for (let i = 0; i < vertCount; i++) {
      position[i * 3] = vertProperties[i * numProp]
      position[i * 3 + 1] = vertProperties[i * numProp + 1]
      position[i * 3 + 2] = vertProperties[i * numProp + 2]
    }
  }
  return { position, index: new Uint32Array(triVerts) }
}

/** Local-space raw geometry for rendering a root node. */
export function computeMeshRaw(M: Wasm, doc: CadDocument, id: NodeId): RawMesh {
  let solid: Manifold | null = null
  try {
    solid = evaluateLocal(M, doc, id)
    return meshToRaw(solid.getMesh())
  } catch (err) {
    console.error('computeMeshRaw failed', err)
    return EMPTY_MESH
  } finally {
    solid?.delete()
  }
}

/** World-space union of the given roots, for export to STL/3MF. */
export function computeExportRaw(M: Wasm, doc: CadDocument, rootIds: NodeId[]): RawMesh {
  let result: Manifold | null = null
  try {
    const solids = rootIds.filter((id) => doc.nodes[id]).map((id) => evaluate(M, doc, id))
    result = unionAll(M, solids)
    return meshToRaw(result.getMesh())
  } catch (err) {
    console.error('computeExportRaw failed', err)
    return EMPTY_MESH
  } finally {
    result?.delete()
  }
}

/** Triangle count + volume (mm³) of a subtree. */
export function measureSolid(M: Wasm, doc: CadDocument, id: NodeId): { triangles: number; volume: number } {
  let solid: Manifold | null = null
  try {
    solid = evaluateLocal(M, doc, id)
    return { triangles: solid.numTri(), volume: solid.volume() }
  } catch {
    return { triangles: 0, volume: 0 }
  } finally {
    solid?.delete()
  }
}
