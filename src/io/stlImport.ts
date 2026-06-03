/**
 * STL import. The mesh is recentered on the origin and dropped onto the build
 * plate (min-Z to z=0). It's stored as a mesh asset; the engine welds its verts
 * (Mesh.merge) when building a Manifold so it can take part in booleans.
 */
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { geometryToRawMesh } from '../geometry/manifoldToThree'
import { useCadStore } from '../document/store'

export async function importStlFile(file: File): Promise<void> {
  const buffer = await file.arrayBuffer()
  const geometry = new STLLoader().parse(buffer)

  geometry.computeBoundingBox()
  const bb = geometry.boundingBox
  if (bb) {
    const cx = (bb.min.x + bb.max.x) / 2
    const cy = (bb.min.y + bb.max.y) / 2
    geometry.translate(-cx, -cy, -bb.min.z)
  }

  const raw = geometryToRawMesh(geometry)
  geometry.dispose()
  const name = file.name.replace(/\.stl$/i, '') || 'Imported'
  useCadStore.getState().addMeshAsset(name, raw.position, raw.index)
}
