/**
 * Pure conversion between raw triangle data and three.js geometry.
 *
 * `RawMesh` is the decoupling boundary: the engine returns plain typed arrays
 * (no Manifold handles, no three.js objects), and this module turns them into a
 * BufferGeometry. Keeping it plain is what lets the engine move into a Web
 * Worker later (typed arrays are transferable).
 */
import * as THREE from 'three'
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js'

export interface RawMesh {
  /** Flat xyz positions: [x0,y0,z0, x1,y1,z1, ...]. */
  position: Float32Array
  /** Triangle indices into `position`. */
  index: Uint32Array
}

export const EMPTY_MESH: RawMesh = {
  position: new Float32Array(0),
  index: new Uint32Array(0),
}

/**
 * Crease angle for auto-smooth shading: edges sharper than this stay faceted,
 * softer ones get averaged normals — like Blender's "Smooth by Angle". 30° keeps
 * box corners and chamfers crisp while smoothing cylinders, spheres, and fillets.
 */
const SMOOTH_CREASE_ANGLE = THREE.MathUtils.degToRad(30)

export function rawMeshToGeometry(raw: RawMesh, smoothShading = false): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(raw.position, 3))
  geometry.setIndex(new THREE.BufferAttribute(raw.index, 1))

  if (smoothShading) {
    // Auto-smooth: bake creased normals so the material can read them directly
    // (flatShading off). toCreasedNormals returns a NEW non-indexed geometry, so
    // drop the indexed source we built above.
    const creased = toCreasedNormals(geometry, SMOOTH_CREASE_ANGLE)
    geometry.dispose()
    creased.computeBoundingBox()
    creased.computeBoundingSphere()
    return creased
  }

  // Flat shading: the material derives per-face normals (flatShading), but we
  // still compute vertex normals so the geometry is correct under any material
  // and for lighting that reads vertex normals.
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

/** A three.js BufferGeometry's positions/index as a RawMesh (for STL import). */
export function geometryToRawMesh(geometry: THREE.BufferGeometry): RawMesh {
  const indexed = geometry.index ? geometry : toIndexed(geometry)
  const position = new Float32Array(indexed.getAttribute('position').array as ArrayLike<number>)
  const index = new Uint32Array(indexed.index!.array as ArrayLike<number>)
  return { position, index }
}

function toIndexed(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.getAttribute('position')
  const index = new Uint32Array(pos.count)
  for (let i = 0; i < pos.count; i++) index[i] = i
  const clone = geometry.clone()
  clone.setIndex(new THREE.BufferAttribute(index, 1))
  return clone
}
