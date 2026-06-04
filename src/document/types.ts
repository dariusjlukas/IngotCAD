/**
 * The CAD document data model.
 *
 * The document is plain, serializable data — the single source of truth.
 * Everything visible (Manifold solids, three.js geometry, the rendered scene)
 * is *derived* from it. Nodes form an explicit CSG tree but are stored in a
 * normalized flat map for O(1) lookup and small, local immutable updates.
 *
 * This module knows nothing about three.js or Manifold and must stay that way.
 */

export type NodeId = string
export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

/** A local transform, relative to the node's parent. Z-up, millimeters, degrees. */
export interface Transform {
  /** Translation in mm. */
  position: Vec3
  /** XYZ Euler rotation in degrees (matches Manifold's native convention). */
  rotationDeg: Vec3
  /** Per-axis scale multipliers (unitless). */
  scale: Vec3
}

export const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotationDeg: [0, 0, 0],
  scale: [1, 1, 1],
}

/** Primitive shape parameters. The discriminant `type` selects the shape. */
export type PrimitiveParams =
  | { type: 'box'; size: Vec3 }
  | {
      type: 'cylinder'
      height: number
      radiusBottom: number
      radiusTop: number
      segments: number
    }
  | { type: 'sphere'; radius: number; segments: number }
  | { type: 'mesh'; assetId: string }
  // A 2D sketch extruded along Z. `profile` is a set of closed contours
  // (each a list of [x,y] points in mm, CCW-wound), extruded by `height`.
  | { type: 'extrusion'; profile: Vec2[][]; height: number }
  // A 2D sketch revolved around the Y axis (x=0) by `degrees`; that axis
  // becomes the solid's Z axis (a lathe operation).
  | { type: 'revolution'; profile: Vec2[][]; degrees: number; segments: number }

export type PrimitiveType = PrimitiveParams['type']

/** How a node combines within its parent group. */
export type Role = 'solid' | 'hole'

/** Boolean operation for an explicit Boolean node. */
export type BooleanOp = 'union' | 'subtract' | 'intersect'

interface BaseNode {
  id: NodeId
  name: string
  /** Transform relative to the parent (or world space for a root). */
  transform: Transform
  /** Top-level visibility (only meaningful for root nodes). */
  visible: boolean
  /** Within a parent group, a `hole` is subtracted instead of unioned. */
  role: Role
  /** Display color (hex). Not exported / not printed. */
  color: string
}

export interface PrimitiveNode extends BaseNode {
  kind: 'primitive'
  params: PrimitiveParams
}

/**
 * A group fuses its children: union of all `solid` children, minus the union
 * of all `hole` children. This is the TinkerCAD-style container.
 */
export interface GroupNode extends BaseNode {
  kind: 'group'
  childIds: NodeId[]
}

/** An explicit boolean of its children, applied left-to-right. */
export interface BooleanNode extends BaseNode {
  kind: 'boolean'
  op: BooleanOp
  childIds: NodeId[]
}

export type CadNode = PrimitiveNode | GroupNode | BooleanNode

/** A node that contains other nodes. */
export type ContainerNode = GroupNode | BooleanNode

/** Raw geometry for an imported mesh (e.g. STL), referenced by `mesh` primitives. */
export interface MeshAsset {
  /** Interleaved is not used here: positions are xyz triples. */
  position: Float32Array
  index: Uint32Array
}

export interface CadDocument {
  schemaVersion: number
  units: 'mm'
  nodes: Record<NodeId, CadNode>
  /** Top-level node order. */
  rootIds: NodeId[]
  assets: Record<string, MeshAsset>
}

export const SCHEMA_VERSION = 1

export function createEmptyDocument(): CadDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    units: 'mm',
    nodes: {},
    rootIds: [],
    assets: {},
  }
}

export function hasChildren(node: CadNode): node is ContainerNode {
  return node.kind === 'group' || node.kind === 'boolean'
}
