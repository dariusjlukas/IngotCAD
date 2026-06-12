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

/**
 * Marks a loop segment as a circular arc through `center`. The center is a real
 * solver point owned by the loop (it participates in constraints and dragging);
 * the radius is *derived* as |start − center| — never stored — so there is a
 * single source of truth, exactly like corner fillets.
 */
export interface SegmentArc {
  center: PointId
  /** True when the arc sweeps counter-clockwise from the segment's start to its end. */
  ccw: boolean
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
      /** Per-segment arcs, keyed by the segment's START point id (segment i → i+1). */
      arcs?: Record<PointId, SegmentArc>
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
  | 'tangent'
  | 'radius'
  | 'angle'

export type Constraint =
  | { id: ConstraintId; kind: 'coincident'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'horizontal'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'vertical'; a: PointId; b: PointId }
  | { id: ConstraintId; kind: 'distance'; a: PointId; b: PointId; value: number; offset?: number }
  | { id: ConstraintId; kind: 'equal'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'parallel'; a: PointId; b: PointId; c: PointId; d: PointId }
  | { id: ConstraintId; kind: 'perpendicular'; a: PointId; b: PointId; c: PointId; d: PointId }
  /**
   * Line a–b tangent to a circle (`shape` = the circle, `c` = its center point)
   * or to a loop arc (`shape` omitted, `c` = the arc's center point).
   */
  | { id: ConstraintId; kind: 'tangent'; a: PointId; b: PointId; c: PointId; shape?: ShapeId }
  /**
   * Radius dimension. `value` is ALWAYS the radius in mm (`diameter` only
   * changes display/editing to 2r). Circle: `shape` set, a/b omitted. Arc:
   * a/b are the arc's endpoints, driven to `value` from the center `c`.
   * `offset` is the label's leader angle (radians, from the center).
   */
  | {
      id: ConstraintId
      kind: 'radius'
      c: PointId
      shape?: ShapeId
      a?: PointId
      b?: PointId
      value: number
      diameter?: boolean
      offset?: number
    }
  /**
   * Directed angle (degrees) from segment a–b to segment c–d. `offset` is the
   * dimension-arc radius for label placement.
   */
  | {
      id: ConstraintId
      kind: 'angle'
      a: PointId
      b: PointId
      c: PointId
      d: PointId
      value: number
      offset?: number
    }

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

/**
 * Provenance of a face-derived plane or face-attached sketch ("associativity
 * lite"): which node the face was picked from, and the face's plane equation in
 * that node's LOCAL space (dot(normal, p) = offset). Local space is deliberate:
 * root transforms never rebuild geometry, so the local plane is untouched by
 * pure moves — at check time it is composed with the source's CURRENT world
 * transform and compared against the stored snapshot to detect drift. Purely a
 * detection key; the snapshot stays the authority for what is rendered.
 */
export interface FaceRef {
  nodeId: NodeId
  normal: Vec3
  offset: number
}

/** The editable source of a sketch-based solid: the sketch and the plane it's on. */
export interface SketchSource {
  data: SketchData
  plane: SketchPlane
  /** Set when the sketch was drawn on a picked face (stale detection). */
  faceRef?: FaceRef
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
  /** Parallel to a picked face (origin + outward normal), offset `distance` mm.
   *  `source` (optional) records which face, for stale detection + rebind. */
  | { kind: 'face'; origin: Vec3; normal: Vec3; distance: number; source?: FaceRef }
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

export type FeatureEdgeKind = 'line' | 'circle'

/**
 * Snapshot signature of a picked sharp edge, in the edgeTreatment node's LOCAL
 * space (= the combined child geometry's space; the wrapper is created with an
 * identity transform). The signature is only a MATCHING KEY: at evaluate time
 * the edge is re-detected on the child's current mesh and matched tolerantly,
 * so the treatment tracks param edits. An unmatched signature is skipped with
 * a warning — never silently applied to the wrong edge.
 */
export interface EdgeSignature {
  kind: FeatureEdgeKind
  /** line: midpoint. circle: circle center. */
  point: Vec3
  /** line: unit direction. circle: unit axis. */
  dir: Vec3
  /** line: segment length. circle: circumference of the detected chain. */
  length: number
  /** circle only. */
  radius?: number
  /** Unit outward normals of the two faces adjacent to the edge. */
  normals: [Vec3, Vec3]
}

export interface EdgeTreatmentEntry {
  id: string
  kind: 'chamfer' | 'fillet'
  /** Chamfer setback / fillet radius, mm. */
  size: number
  edge: EdgeSignature
}

/**
 * Chamfers/fillets selected sharp edges of its source subtree (straight and
 * closed circular edges; convex edges are cut, concave edges filled — both
 * built as boolean tools in the engine).
 */
export interface EdgeTreatmentNode extends BaseNode {
  kind: 'edgeTreatment'
  entries: EdgeTreatmentEntry[]
  childIds: NodeId[]
}

export type CadNode =
  | PrimitiveNode
  | GroupNode
  | BooleanNode
  | PatternNode
  | ShellNode
  | EdgeTreatmentNode

/** A node that contains other nodes. */
export type ContainerNode = GroupNode | BooleanNode | PatternNode | ShellNode | EdgeTreatmentNode

/** Raw geometry for an imported mesh (e.g. STL), referenced by `mesh` primitives. */
export interface MeshAsset {
  /** Interleaved is not used here: positions are xyz triples. */
  position: Float32Array
  index: Uint32Array
}

/** A named document parameter; `expr` may reference other variables. */
export interface DocVariable {
  name: string
  expr: string
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
  /** Named parameters ("wall = 2.4") usable in dimension fields. */
  variables: DocVariable[]
  /**
   * Expression bindings on numeric node fields, keyed `nodeId:path` (e.g.
   * "abc:params.size.0"). The bound field still stores a plain NUMBER — the
   * geometry pipeline never sees expressions — and editing a variable rewrites
   * every bound number through one undoable mutation.
   */
  bindings: Record<string, string>
}

export const SCHEMA_VERSION = 2

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
    variables: [],
    bindings: {},
  }
}

export function hasChildren(node: CadNode): node is ContainerNode {
  return (
    node.kind === 'group' ||
    node.kind === 'boolean' ||
    node.kind === 'pattern' ||
    node.kind === 'shell' ||
    node.kind === 'edgeTreatment'
  )
}
