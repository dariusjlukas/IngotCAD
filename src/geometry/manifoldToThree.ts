/**
 * Pure conversion between raw triangle data and three.js geometry.
 *
 * `RawMesh` is the decoupling boundary: the engine returns plain typed arrays
 * (no Manifold handles, no three.js objects), and this module turns them into a
 * BufferGeometry. Keeping it plain is what lets the engine move into a Web
 * Worker later (typed arrays are transferable).
 */
import * as THREE from 'three'

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

export function rawMeshToGeometry(raw: RawMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(raw.position, 3))
  geometry.setIndex(new THREE.BufferAttribute(raw.index, 1))
  // Materials use flatShading, but normals are still computed so the geometry
  // is correct under any material and for lighting that reads vertex normals.
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
