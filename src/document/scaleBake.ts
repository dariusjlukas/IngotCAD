/**
 * Folding a node's local `transform.scale` into a primitive's parametric
 * dimensions.
 *
 * Scaling a *leaf primitive* should resize it — the parametric fields (box
 * `size`, sphere `radius`, cylinder radii/height) are the single source of truth
 * for "how big is this, in mm", which matters for a 3D-printing tool. A leftover
 * `transform.scale` multiplier on top of those fields is ambiguous and a footgun
 * (set "20mm", print 40mm). So scaling commits bake the scale into the params and
 * reset the scale to identity.
 *
 * This is exact regardless of rotation: a TRS transform is `T·R·S`, so scale is
 * applied in the object's *local* frame before rotation — the same frame the
 * params are defined in. Only the node's own local scale is folded; ancestor
 * (group) scale is left untouched.
 *
 * Baking is all-or-nothing per node and only happens when the scale stays
 * representable by the primitive's parameters:
 *   - box       — always (per-axis).
 *   - sphere    — only a uniform scale (otherwise it'd be an ellipsoid).
 *   - cylinder  — only when X==Y scale (otherwise an elliptical cylinder).
 * Everything else (non-uniform sphere/cylinder, extrusion, revolution, mesh)
 * is not bakeable: `bakeScaleIntoParams` returns null and the caller keeps the
 * scale on the transform exactly as before.
 *
 * Pure data only — no three.js / Manifold here.
 */
import type { PrimitiveParams, Vec2, Vec3 } from './types'

/** Smallest dimension the param editors allow; baked dims clamp to it. */
const MIN_DIM = 0.1

/** A scale axis within this of 1 counts as "no scale on that axis". */
const IDENTITY_EPS = 1e-6

function isOne(x: number): boolean {
  return Math.abs(x - 1) <= IDENTITY_EPS
}

/** Relative comparison — used to decide whether a scale is uniform enough to bake. */
function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b))
}

function atLeast(min: number, value: number): number {
  return value < min ? min : value
}

export interface BakeResult {
  params: PrimitiveParams
  /** Scale to leave on the transform after baking (identity when fully folded). */
  residualScale: Vec3
}

/**
 * Fold `scale` into `params` where the result is still representable by the
 * primitive. Returns null when there's nothing to bake (identity scale) or the
 * primitive can't absorb this scale (caller should keep the scale as-is).
 */
export function bakeScaleIntoParams(params: PrimitiveParams, scale: Vec3): BakeResult | null {
  const [sx, sy, sz] = scale
  if (isOne(sx) && isOne(sy) && isOne(sz)) return null

  switch (params.type) {
    case 'box':
      return {
        params: {
          ...params,
          size: [
            atLeast(MIN_DIM, params.size[0] * sx),
            atLeast(MIN_DIM, params.size[1] * sy),
            atLeast(MIN_DIM, params.size[2] * sz),
          ],
        },
        residualScale: [1, 1, 1],
      }
    case 'sphere':
      // Only a uniform scale stays a sphere; otherwise keep it (an ellipsoid).
      if (!approxEqual(sx, sy) || !approxEqual(sy, sz)) return null
      return {
        params: { ...params, radius: atLeast(MIN_DIM, params.radius * sx) },
        residualScale: [1, 1, 1],
      }
    case 'cylinder':
      // The radii are single scalars: only a uniform XY scale stays a cylinder.
      // Z is independent and always foldable into height.
      if (!approxEqual(sx, sy)) return null
      return {
        params: {
          ...params,
          radiusBottom: atLeast(0, params.radiusBottom * sx),
          radiusTop: atLeast(0, params.radiusTop * sx),
          height: atLeast(MIN_DIM, params.height * sz),
        },
        residualScale: [1, 1, 1],
      }
    case 'extrusion':
    case 'revolution':
    case 'mesh':
      // Not foldable into params — keep the scale on the transform.
      return null
  }
}

function profileBounds(
  contours: Vec2[][],
): { minX: number; maxX: number; width: number; height: number } | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const contour of contours) {
    for (const [x, y] of contour) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (minX === Infinity) return null
  return { minX, maxX, width: maxX - minX, height: maxY - minY }
}

/**
 * The primitive's own bounding dimensions (mm) along its local axes, before any
 * transform. Used for the property editor's "effective size" readout. Returns
 * null when the dimensions can't be derived from params alone (imported mesh).
 */
export function primitiveLocalDimensions(params: PrimitiveParams): Vec3 | null {
  switch (params.type) {
    case 'box':
      return [params.size[0], params.size[1], params.size[2]]
    case 'sphere': {
      const d = params.radius * 2
      return [d, d, d]
    }
    case 'cylinder': {
      const d = Math.max(params.radiusBottom, params.radiusTop) * 2
      return [d, d, params.height]
    }
    case 'extrusion': {
      const b = profileBounds(params.profile)
      return b ? [b.width, b.height, params.height] : [0, 0, params.height]
    }
    case 'revolution': {
      // Revolved around x=0: radial extent = max |x|, height = profile Y range.
      const b = profileBounds(params.profile)
      if (!b) return null
      const diameter = Math.max(Math.abs(b.minX), Math.abs(b.maxX)) * 2
      return [diameter, diameter, b.height]
    }
    case 'mesh':
      return null
  }
}
