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

// ---------------------------------------------------------------------------
// Sketch data. Lives here (the data layer) so sketch-based solids can store
// their editable source on the node. The sketch *behavior* (solver, contour
// extraction, plane math) lives in src/sketch/, which imports these types.
// ---------------------------------------------------------------------------

export type PointId = string
export type ShapeId = string
export type ConstraintId = string

export interface SPoint {
  x: number
  y: number
  /** Anchored points are never moved by the solver. */
  fixed: boolean
}

/**
 * A rounded (fillet) or beveled (chamfer) treatment on a single loop corner.
 * `size` is the fillet radius, or the chamfer's equal setback distance per edge
 * (mm). The corner stays a real solver point — the rounded geometry is *derived*
 * at contour/render time (see loopOutline), exactly like a circle's radius.
 */
export interface CornerTreatment {
  kind: 'fillet' | 'chamfer'
  size: number
}

// `construction` geometry is reference-only: it participates in constraints and
// snapping but is excluded from the extrude/revolve profile (see shapeContours).
export type SketchShape =
  | {
      id: ShapeId
      kind: 'loop'
      pts: PointId[]
      construction?: boolean
      /** Per-corner fillet/chamfer, keyed by the corner's point id. */
      corners?: Record<PointId, CornerTreatment>
    }
  | { id: ShapeId; kind: 'circle'; c: PointId; r: number; construction?: boolean }

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'equal'
  | 'parallel'
  | 'perpendicular'

export type Constraint =
  | { id: ConstraintId; kind: 'coincident'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'horizontal'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'vertical'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'distance'; a: PointId; b: PointId; value: number; offset?: number }
  | { id: ConstraintId; kind: 'equal'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'parallel'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'perpendicular'; a: PointId; b: PointId; c: PointId; d: PointId }

export interface SketchData {
  points: Record<PointId, SPoint>
  shapes: SketchShape[]
  constraints: Constraint[]
}

export type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never
export type ConstraintInput = DistributiveOmit<Constraint, 'id'>

export type PlaneKind = 'xy' | 'xz' | 'yz'

/** An oriented 2D frame embedded in world space (origin + U/V/N basis). */
export interface SketchPlane {
  origin: Vec3
  u: Vec3
  v: Vec3
  n: Vec3
}

/** The editable source of a sketch-based solid: the sketch and the plane it's on. */
export interface SketchSource {
  data: SketchData
  plane: SketchPlane
}

// ---------------------------------------------------------------------------
// Construction planes (datums): named reference planes the user can sketch on.
// These are NOT geometry — they live alongside the CSG node tree, never enter
// evaluation, and are resolved to a SketchPlane on demand (see src/sketch/plane).
// ---------------------------------------------------------------------------

/**
 * How a construction plane is built. Picked geometry (faces, points, edges) is
 * snapshotted into the definition, so a plane is resolvable purely from this
 * data with no live dependency on the objects it was derived from (associativity
 * is intentionally deferred — consistent with how sketches store a static plane).
 */
export type PlaneDefinition =
  /** Parallel to a cardinal plane, shifted `distance` mm along its normal. */
  | { kind: 'offset'; base: PlaneKind; distance: number }
  /** Parallel to a picked face (origin + outward normal), offset `distance` mm. */
  | { kind: 'face'; origin: Vec3; normal: Vec3; distance: number }
  /** Through three picked points (a = origin, a→b = U, normal = (b−a)×(c−a)). */
  | { kind: 'threePoints'; a: Vec3; b: Vec3; c: Vec3 }
  /** Hinged about an edge: `refNormal` rotated `angleDeg` about the edge `axis`. */
  | { kind: 'edgeAngle'; origin: Vec3; axis: Vec3; refNormal: Vec3; angleDeg: number }

/** A reference plane the user can sketch on. Reference data, not a solid. */
export interface ConstructionPlane {
  id: string
  name: string
  visible: boolean
  definition: PlaneDefinition
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
  // `flip` extrudes toward -Z (the other side of the plane) instead of +Z.
  // `sketch` (optional) is the editable source the profile was solved from.
  | { type: 'extrusion'; profile: Vec2[][]; height: number; flip?: boolean; sketch?: SketchSource }
  // A 2D sketch revolved around the Y axis (x=0) by `degrees`; that axis
  // becomes the solid's Z axis (a lathe operation).
  | {
      type: 'revolution'
      profile: Vec2[][]
      degrees: number
      segments: number
      sketch?: SketchSource
    }
  // Extruded text. `profile` is the pre-tessellated glyph outline set (outer
  // contours + hole contours, mm, Y-up), extruded `height` along +Z using the
  // even-odd fill rule so counters (the holes in A/O/e) come out hollow. `text`
  // and `size` are kept so the label can be re-typed / re-sized (which
  // regenerates the profile via the font, in the UI layer).
  | { type: 'text'; text: string; size: number; height: number; profile: Vec2[][] }

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

/**
 * How a pattern replicates its source subtree. All coordinates are in the
 * pattern node's local space (which equals world space when the node sits at the
 * root with an identity transform, the normal case after creation).
 */
export type PatternSpec =
  /** `count` copies spaced `offset` mm apart per step (copy 0 = the original). */
  | { mode: 'linear'; count: number; offset: Vec3 }
  /**
   * `count` copies revolved about the axis line (`axisOrigin` + `axisDir`),
   * spanning `angleDeg` total. A full 360° wraps evenly with no overlap.
   */
  | { mode: 'circular'; count: number; angleDeg: number; axisOrigin: Vec3; axisDir: Vec3 }
  /**
   * A reflection across the plane (`planeOrigin` + `planeNormal`).
   * `keepOriginal` unions the source with its mirror image (vs. mirror only).
   */
  | { mode: 'mirror'; planeOrigin: Vec3; planeNormal: Vec3; keepOriginal: boolean }

export type PatternMode = PatternSpec['mode']

/**
 * Replicates its source subtree (the children, combined) into a linear /
 * circular array or a mirror image. The replication is *derived* in the engine
 * (Manifold), so the result is a single watertight solid and the source stays
 * editable as a normal child.
 */
export interface PatternNode extends BaseNode {
  kind: 'pattern'
  spec: PatternSpec
  childIds: NodeId[]
}

/**
 * Hollows its source subtree to a wall of `thickness` mm (an inward offset
 * subtracted from the solid), optionally leaving the +Z top open (a lid/box).
 */
export interface ShellNode extends BaseNode {
  kind: 'shell'
  thickness: number
  openTop: boolean
  childIds: NodeId[]
}

export type CadNode = PrimitiveNode | GroupNode | BooleanNode | PatternNode | ShellNode

/** A node that contains other nodes. */
export type ContainerNode = GroupNode | BooleanNode | PatternNode | ShellNode

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
  /** Node ids in creation order, for the timeline. Filter to existing nodes. */
  featureOrder: NodeId[]
  /** User-created construction planes (datums), keyed by id. */
  planes: Record<string, ConstructionPlane>
  /** Construction-plane id order, for listing in the outliner. */
  planeOrder: string[]
}

export const SCHEMA_VERSION = 1

export function createEmptyDocument(): CadDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    units: 'mm',
    nodes: {},
    rootIds: [],
    assets: {},
    featureOrder: [],
    planes: {},
    planeOrder: [],
  }
}

export function hasChildren(node: CadNode): node is ContainerNode {
  return (
    node.kind === 'group' ||
    node.kind === 'boolean' ||
    node.kind === 'pattern' ||
    node.kind === 'shell'
  )
}
