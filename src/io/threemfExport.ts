/**
 * 3MF export — the modern print format (carries units, multi-object, color).
 * Geometry goes through Manifold, so output is watertight. 3MF is millimeter-
 * based by default, matching our coordinate system.
 */
import * as THREE from 'three'
import { exportTo3MF } from 'three-3mf-exporter'
import type { CadDocument } from '../document/types'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { downloadBlob } from './download'

export async function export3mf(doc: CadDocument, filename = 'model.3mf'): Promise<void> {
  const visibleRoots = doc.rootIds.filter((id) => doc.nodes[id]?.visible)
  if (visibleRoots.length === 0) return

  const raw = await engine.computeExportMesh(doc, visibleRoots)
  if (raw.index.length === 0) return

  const geometry = rawMeshToGeometry(raw)
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry))

  const blob = await exportTo3MF(group, { metadata: { Application: 'Ingot-CAD' } })
  geometry.dispose()
  downloadBlob(blob, filename)
}
