/**
 * STL import. The mesh is recentered on the origin and dropped onto the build
 * plate (min-Z to z=0). It's stored as a mesh asset; the engine welds its verts
 * (Mesh.merge) when building a Manifold so it can take part in booleans.
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { geometryToRawMesh, type RawMesh } from '../geometry/manifoldToThree'
import { useCadStore } from '../document/store'

/**
 * Parse an STL buffer into a recentered RawMesh. Throws on invalid vertex data:
 * a single non-finite vertex would make the bounding box NaN and the recenter
 * translate would then rewrite EVERY vertex to NaN, silently corrupting the
 * imported asset. Split from the File/store wrapper so it's unit-testable.
 */
export function parseStlBuffer(buffer: ArrayBuffer): RawMesh {
  const geometry = new STLLoader().parse(buffer)

  const position = geometry.getAttribute('position').array
  for (let i = 0; i < position.length; i++) {
    if (!Number.isFinite(position[i])) {
      geometry.dispose()
      throw new Error('STL contains invalid (non-finite) vertex data')
    }
  }

  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (bb) {
    const cx = (bb.min.x + bb.max.x) / 2
    const cy = (bb.min.y + bb.max.y) / 2
    geometry.translate(-cx, -cy, -bb.min.z)
  }

  const raw = geometryToRawMesh(geometry)
  geometry.dispose()
  return raw
}

export async function importStlFile(file: File): Promise<void> {
  const raw = parseStlBuffer(await file.arrayBuffer())
  const name = file.name.replace(/\.stl$/i, '') || 'Imported'
  useCadStore.getState().addMeshAsset(name, raw.position, raw.index)
}
