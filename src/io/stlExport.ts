/**
 * STL export. The geometry always goes through Manifold (engine.computeExportMesh),
 * guaranteeing a watertight, printable mesh regardless of how it was modeled.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import type { CadDocument } from '../document/types'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { downloadBlob } from './download'

export async function exportStl(doc: CadDocument, filename = 'model.stl'): Promise<void> {
  const visibleRoots = doc.rootIds.filter((id) => doc.nodes[id]?.visible)
  if (visibleRoots.length === 0) return

  const raw = await engine.computeExportMesh(doc, visibleRoots)
  if (raw.index.length === 0) return

  const geometry = rawMeshToGeometry(raw)
  const mesh = new THREE.Mesh(geometry)
  const data = new STLExporter().parse(mesh, { binary: true })
  geometry.dispose()

  // 1 three.js unit == 1 mm; STL is unitless and slicers assume mm.
  const blob = new Blob([data as unknown as BlobPart], { type: 'model/stl' })
  downloadBlob(blob, filename)
}
