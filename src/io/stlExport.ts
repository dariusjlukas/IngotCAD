/**
 * STL export. The geometry always goes through Manifold (engine.computeExportMesh),
 * guaranteeing a watertight, printable mesh regardless of how it was modeled.
 */
import * as THREE from 'three'
import { STLExporter } from 'three/addons/exporters/STLExporter.js'
import type { CadDocument } from '../document/types'
import { currentRootOverrides } from '../document/resolvedStore'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { downloadBlob } from './download'

/** Returns true if a file was downloaded, false if the model evaluates to empty geometry. */
export async function exportStl(doc: CadDocument, filename = 'model.stl'): Promise<boolean> {
  const visibleRoots = doc.rootIds.filter((id) => doc.nodes[id]?.visible)
  if (visibleRoots.length === 0) return false

  // Resolved face-attachment placement, so the file matches the viewport.
  const raw = await engine.computeExportMesh(doc, visibleRoots, currentRootOverrides())
  if (raw.index.length === 0) return false

  const geometry = rawMeshToGeometry(raw)
  const mesh = new THREE.Mesh(geometry)
  const data = new STLExporter().parse(mesh, { binary: true })
  geometry.dispose()

  // 1 three.js unit == 1 mm; STL is unitless and slicers assume mm.
  const blob = new Blob([data as unknown as BlobPart], { type: 'model/stl' })
  downloadBlob(blob, filename)
  return true
}
