/**
 * 3MF export — the modern print format (carries units, multi-object, color).
 * Geometry goes through Manifold, so output is watertight. 3MF is millimeter-
 * based by default, matching our coordinate system.
 */
import * as THREE from 'three'
import { strFromU8, strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js'
import { exportTo3MF } from 'three-3mf-exporter'
import type { CadDocument } from '../document/types'
import { currentRootOverrides } from '../document/resolvedStore'
import { engine } from '../engine/engine'
import { rawMeshToGeometry } from '../geometry/manifoldToThree'
import { downloadBlob } from './download'

const MODEL_PATH = '3D/3dmodel.model'

/**
 * three-3mf-exporter hardcodes two Bambu-Studio-isms its config can't turn off:
 * it recenters the model on the printer bed (discarding document placement, so
 * separately exported parts no longer align when reassembled) and declares
 * `requiredextensions="p"` without emitting any production-extension data
 * (spec-invalid — a conformant core-only consumer must reject the file). A 3MF
 * is a plain zip, so unpack it, patch the model XML, and repack.
 *
 * Exported for tests.
 */
export async function fixup3mf(blob: Blob): Promise<Blob> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const model = files[MODEL_PATH]
  if (!model) return blob

  let xml = strFromU8(model)
  xml = xml.replace(/\s*requiredextensions="p"/, '')
  // We export a single world-space mesh under an identity group, so the only
  // correct build-item transform is identity — this undoes the bed recenter
  // and keeps the document's own placement.
  xml = xml.replace(
    /(<item\b[^>]*\btransform=")[^"]*(")/g,
    (_, pre: string, post: string) => `${pre}1 0 0 0 1 0 0 0 1 0 0 0${post}`,
  )

  files[MODEL_PATH] = strToU8(xml)
  return new Blob([zipSync(files) as unknown as BlobPart], { type: blob.type })
}

/** Returns true if a file was downloaded, false if the model evaluates to empty geometry. */
export async function export3mf(doc: CadDocument, filename = 'model.3mf'): Promise<boolean> {
  const visibleRoots = doc.rootIds.filter((id) => doc.nodes[id]?.visible)
  if (visibleRoots.length === 0) return false

  // Resolved face-attachment placement, so the file matches the viewport.
  const raw = await engine.computeExportMesh(doc, visibleRoots, currentRootOverrides())
  if (raw.index.length === 0) return false

  const geometry = rawMeshToGeometry(raw)
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry))

  const blob = await exportTo3MF(group, { metadata: { Application: 'Ingot-CAD' } })
  geometry.dispose()
  downloadBlob(await fixup3mf(blob), filename)
  return true
}
