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
import type { ManifoldToplevel, Manifold, Mat4, CrossSection } from 'manifold-3d'
import type {
  BooleanOp,
  CadDocument,
  NodeId,
  PatternSpec,
  PrimitiveParams,
  Role,
  Vec2,
} from '../document/types'
import type { RawMesh } from '../geometry/manifoldToThree'
import { EMPTY_MESH } from '../geometry/manifoldToThree'
import { applyEdgeTreatments } from './edgeTreatment'
import type { EvalWarning } from './protocol'
import {
  axisRotationMatrix,
  isIdentityTransform,
  planeReflectionMatrix,
  transformToMat4Array,
  translationMatrix,
} from '../geometry/transform'

type Wasm = ManifoldToplevel

/** Collector for non-fatal evaluation warnings (edge treatments that no longer
 *  bind, etc.). Optional everywhere; defaults to dropping them. */
export type WarnFn = (w: EvalWarning) => void

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
      return buildExtrusion(M, params.profile, params.height, params.flip ?? false)
    case 'revolution':
      return buildRevolution(M, params.profile, params.degrees, params.segments)
    case 'text':
      return buildText(M, params.profile, params.height)
  }
}

function buildText(M: Wasm, profile: Vec2[][], height: number): Manifold {
  if (profile.length === 0 || height <= 0) return emptySolid(M)
  // Even-odd interprets nested contours as holes regardless of winding, so glyph
  // counters (A/O/e) come out hollow. Extrude 0..height along +Z (rests on z=0).
  const cross = new M.CrossSection(profile, 'EvenOdd')
  const solid = cross.extrude(height, 0, 0, undefined, false)
  cross.delete()
  return solid
}

function buildRevolution(M: Wasm, profile: Vec2[][], degrees: number, segments: number): Manifold {
  if (profile.length === 0 || degrees <= 0) return emptySolid(M)
  // Revolve around the cross-section's Y axis (x=0), which becomes the Z axis.
  const cross = new M.CrossSection(profile, 'Positive')
  const solid = cross.revolve(segments, degrees)
  cross.delete()
  return solid
}

function buildExtrusion(M: Wasm, profile: Vec2[][], height: number, flip: boolean): Manifold {
  if (profile.length === 0 || height <= 0) return emptySolid(M)
  // CrossSection unions the contours (Positive fill rule); extrude from 0 to
  // +height along local +Z so it grows *out of* the sketch plane (the node's
  // transform places that plane). Not centered.
  const cross = new M.CrossSection(profile, 'Positive')
  let solid = cross.extrude(height, 0, 0, undefined, false)
  cross.delete()
  if (flip) {
    // Move it to span -height..0 so it grows the other way (profile unchanged).
    const moved = solid.translate(0, 0, -height)
    solid.delete()
    solid = moved
  }
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

/** Hard cap on pattern instances, guarding against a fat-fingered count. */
const PATTERN_MAX = 512
/** Circular cross-section of the structuring sphere used to shell (offset). */
const SHELL_BALL_SEGMENTS = 16

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 1
  return Math.max(1, Math.min(PATTERN_MAX, Math.floor(count)))
}

/**
 * Per-instance placement matrices for a pattern. `null` marks the source's own
 * place (copy 0 / the un-reflected original) so the engine can reuse the base
 * solid there instead of transforming a needless copy.
 */
function patternMatrices(spec: PatternSpec): (number[] | null)[] {
  switch (spec.mode) {
    case 'linear': {
      const n = clampCount(spec.count)
      const out: (number[] | null)[] = []
      for (let i = 0; i < n; i++) {
        out.push(
          i === 0
            ? null
            : translationMatrix([spec.offset[0] * i, spec.offset[1] * i, spec.offset[2] * i]),
        )
      }
      return out
    }
    case 'circular': {
      const n = clampCount(spec.count)
      // A full turn divides evenly (no overlapping last copy); a partial arc
      // spreads the copies inclusively from 0 to angleDeg.
      const full = spec.angleDeg >= 360 - 1e-6
      const step = full ? 360 / n : spec.angleDeg / Math.max(1, n - 1)
      const out: (number[] | null)[] = []
      for (let i = 0; i < n; i++) {
        out.push(i === 0 ? null : axisRotationMatrix(spec.axisOrigin, spec.axisDir, step * i))
      }
      return out
    }
    case 'mirror': {
      const refl = planeReflectionMatrix(spec.planeOrigin, spec.planeNormal)
      return spec.keepOriginal ? [null, refl] : [refl]
    }
  }
}

function combinePattern(M: Wasm, baseSolids: Manifold[], spec: PatternSpec): Manifold {
  const base = unionAll(M, baseSolids) // we now own `base`
  const parts: Manifold[] = []
  let baseUsed = false
  for (const mat of patternMatrices(spec)) {
    if (mat === null) {
      parts.push(base)
      baseUsed = true
    } else {
      parts.push(base.transform(mat as unknown as Mat4))
    }
  }
  const result = unionAll(M, parts) // consumes every part (incl. base when used)
  // `base` not placed anywhere (mirror without the original) → free it.
  if (!baseUsed) base.delete()
  return result
}

function combineShell(
  M: Wasm,
  baseSolids: Manifold[],
  thickness: number,
  openTop: boolean,
): Manifold {
  const base = unionAll(M, baseSolids)
  if (thickness <= 0) return base
  // Inward offset = morphological erosion by a ball of radius `thickness`.
  const ball = M.Manifold.sphere(thickness, SHELL_BALL_SEGMENTS)
  const inner = base.minkowskiDifference(ball)
  ball.delete()
  let cut = inner
  if (openTop && inner.volume() > 1e-6) {
    // Open the +Z top by extruding the cavity up through the lid, keeping the
    // side walls full height (the cavity footprint is smaller than the outside).
    // Shift a copy of the cavity up by an amount that pokes above the part top
    // (> the lid wall) yet stays joined to the original cavity (< its height),
    // so the merged hole punches cleanly through only the lid.
    const ibb = inner.boundingBox()
    const bbb = base.boundingBox()
    const cavityH = ibb.max[2] - ibb.min[2]
    const lidGap = bbb.max[2] - ibb.max[2]
    if (cavityH > lidGap) {
      const lifted = inner.translate(0, 0, (lidGap + cavityH) / 2)
      cut = M.Manifold.union([inner, lifted])
      inner.delete()
      lifted.delete()
    }
  }
  const result = base.subtract(cut)
  cut.delete()
  base.delete()
  return result
}

export function evaluateLocal(M: Wasm, doc: CadDocument, id: NodeId, warn?: WarnFn): Manifold {
  const node = doc.nodes[id]
  if (!node) throw new Error(`Unknown node: ${id}`)
  if (node.kind === 'primitive') return buildPrimitive(M, doc, node.params)

  const children: RoledSolid[] = []
  for (const cid of node.childIds) {
    const child = doc.nodes[cid]
    if (!child) continue
    try {
      children.push({ role: child.role, solid: evaluate(M, doc, cid, warn) })
    } catch (err) {
      // Free the siblings evaluated before the failure: computeMeshRaw catches
      // the rethrow and returns EMPTY_MESH, but without this every
      // re-evaluation of a failing tree would leak its healthy WASM solids.
      for (const c of children) c.solid.delete()
      throw err
    }
  }

  if (children.length === 0) return emptySolid(M)
  const solids = children.map((c) => c.solid)
  switch (node.kind) {
    case 'group':
      return combineGroup(M, children)
    case 'boolean':
      // Roles don't apply here: the op itself says how children combine.
      return combineBoolean(M, solids, node.op)
    case 'pattern':
      // Honor solid/hole roles like a group, then replicate the combined body.
      return combinePattern(M, [combineGroup(M, children)], node.spec)
    case 'shell':
      // Honor solid/hole roles like a group, then hollow the combined body.
      return combineShell(M, [combineGroup(M, children)], node.thickness, node.openTop)
    case 'edgeTreatment': {
      // Honor solid/hole roles like a group, then cut the picked edges.
      const base = combineGroup(M, children)
      return applyEdgeTreatments(M, base, node.entries, (w) => warn?.({ ...w, nodeId: node.id }))
    }
  }
}

export function evaluate(M: Wasm, doc: CadDocument, id: NodeId, warn?: WarnFn): Manifold {
  const local = evaluateLocal(M, doc, id, warn)
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
export function computeMeshRaw(M: Wasm, doc: CadDocument, id: NodeId, warn?: WarnFn): RawMesh {
  let solid: Manifold | null = null
  try {
    solid = evaluateLocal(M, doc, id, warn)
    return meshToRaw(solid.getMesh())
  } catch (err) {
    console.error('computeMeshRaw failed', err)
    return EMPTY_MESH
  } finally {
    solid?.delete()
  }
}

/** World-space union of the given roots, for export to STL/3MF. */
export function computeExportRaw(
  M: Wasm,
  doc: CadDocument,
  rootIds: NodeId[],
  warn?: WarnFn,
): RawMesh {
  let result: Manifold | null = null
  try {
    const solids = rootIds.filter((id) => doc.nodes[id]).map((id) => evaluate(M, doc, id, warn))
    result = unionAll(M, solids)
    return meshToRaw(result.getMesh())
  } catch (err) {
    console.error('computeExportRaw failed', err)
    return EMPTY_MESH
  } finally {
    result?.delete()
  }
}

const SECTION_EPSILON_MM = 0.01

/**
 * In-plane section of one world-space solid: transform into plane-local space
 * (invMatrix = world→local), then take the cross section at local z=0 — only the
 * geometry lying in the plane, NOT the silhouette of what's in front/behind.
 *
 * We section a hair to each side of the plane and union the two. This captures
 * geometry crossing the plane *and* faces that lie in it (e.g. when sketching on
 * a face): Manifold's slice() returns empty at the very top of a solid's
 * bounding box, so a face coincident with the plane would otherwise vanish
 * depending on which side its solid sits on; the offsets dodge that boundary.
 *
 * Returns the section outline polygons in plane-local mm.
 */
function sectionSolid(worldSolid: Manifold, invMatrix: number[]): Vec2[][] {
  let local: Manifold | null = null
  let below: CrossSection | null = null
  let above: CrossSection | null = null
  let section: CrossSection | null = null
  try {
    local = worldSolid.transform(invMatrix as unknown as Mat4)
    below = local.slice(-SECTION_EPSILON_MM)
    above = local.slice(SECTION_EPSILON_MM)
    section = below.add(above)
    return section.toPolygons().map((poly) => poly.map((p) => [p[0], p[1]] as Vec2))
  } finally {
    section?.delete()
    above?.delete()
    below?.delete()
    local?.delete()
  }
}

/**
 * Section the visible scene with a sketch plane, ONE geometry at a time: each
 * root is evaluated and sectioned independently, so overlapping objects keep
 * their own outlines instead of merging into a single silhouette. Returns one
 * polygon-group per geometry that actually meets the plane (plane-local mm), for
 * the reference underlay in the sketch view and the Project tool.
 */
export function projectSceneRaw(
  M: Wasm,
  doc: CadDocument,
  rootIds: NodeId[],
  invMatrix: number[],
): Vec2[][][] {
  const groups: Vec2[][][] = []
  for (const id of rootIds) {
    if (!doc.nodes[id]) continue
    let solid: Manifold | null = null
    try {
      solid = evaluate(M, doc, id)
      const polys = sectionSolid(solid, invMatrix)
      if (polys.length) groups.push(polys)
    } catch (err) {
      console.error('projectSceneRaw failed for node', id, err)
    } finally {
      solid?.delete()
    }
  }
  return groups
}

/** Parent container of a node, or null for a root. */
function parentIdOf(doc: CadDocument, id: NodeId): NodeId | null {
  for (const [nid, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'primitive' && node.childIds.includes(id)) return nid
  }
  return null
}

/**
 * Triangle count + volume (mm³) of a subtree, in WORLD space: the node's own
 * transform and every ancestor's are applied, so the volume matches the
 * exported/printed part even when the node (or a wrapping group) is scaled.
 */
export function measureSolid(
  M: Wasm,
  doc: CadDocument,
  id: NodeId,
): { triangles: number; volume: number } {
  let solid: Manifold | null = null
  try {
    let s = evaluate(M, doc, id)
    solid = s
    for (let cur = parentIdOf(doc, id); cur; cur = parentIdOf(doc, cur)) {
      const tr = doc.nodes[cur].transform
      if (isIdentityTransform(tr)) continue
      const next = s.transform(transformToMat4Array(tr) as unknown as Mat4)
      s.delete()
      s = next
      solid = s
    }
    return { triangles: s.numTri(), volume: s.volume() }
  } catch {
    return { triangles: 0, volume: 0 }
  } finally {
    solid?.delete()
  }
}
