import { describe, it, expect, vi } from 'vitest'
import * as THREE from 'three'
import { exportTo3MF } from 'three-3mf-exporter'
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js'

// threemfExport imports the engine singleton, which eagerly loads the Manifold
// WASM (unavailable under vitest) — stub it out; fixup3mf never touches it.
vi.mock('../engine/engine', () => ({ engine: {} }))
const { fixup3mf } = await import('./threemfExport')

const IDENTITY = '1 0 0 0 1 0 0 0 1 0 0 0'

/** A single triangle placed away from the origin, wrapped like export3mf wraps meshes. */
function offsetTriangleGroup(): THREE.Group {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([30, 40, 7, 40, 40, 7, 30, 50, 7]), 3),
  )
  geometry.setIndex([0, 1, 2])
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry))
  return group
}

async function modelXml(blob: Blob): Promise<string> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  return strFromU8(files['3D/3dmodel.model'])
}

function itemTransform(xml: string): string | undefined {
  return /<item\b[^>]*\btransform="([^"]*)"/.exec(xml)?.[1]
}

describe('fixup3mf', () => {
  it('strips the invalid requiredextensions="p" declaration', async () => {
    const blob = await exportTo3MF(offsetTriangleGroup())
    expect(await modelXml(blob)).toContain('requiredextensions="p"')

    const fixed = await modelXml(await fixup3mf(blob))
    expect(fixed).not.toContain('requiredextensions')
    expect(fixed).toContain('<model ') // still a model document
  })

  it('undoes the bed recenter so document placement is preserved', async () => {
    const blob = await exportTo3MF(offsetTriangleGroup())
    // The library shifts the build item to center the part on a 256x256 bed.
    expect(itemTransform(await modelXml(blob))).not.toBe(IDENTITY)

    const fixed = await modelXml(await fixup3mf(blob))
    expect(itemTransform(fixed)).toBe(IDENTITY)
    // The mesh vertices themselves stay in document coordinates.
    expect(fixed).toContain('x="30.00000"')
  })
})
