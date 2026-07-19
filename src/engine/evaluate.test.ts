import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { computeExportRaw, measureSolid, projectSceneRaw } from './evaluate'
import { cardinalPlane, planeFromFace, worldToLocalMatrix } from '../sketch/plane'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type { CadDocument, CadNode, PrimitiveParams, Vec2, Vec3 } from '../document/types'

let M: ManifoldToplevel

beforeAll(async () => {
  M = await Module()
  M.setup()
})

function prim(
  id: string,
  params: PrimitiveParams,
  pos: [number, number, number] = [0, 0, 0],
): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM, position: pos },
    params,
  }
}

function docOf(nodes: CadNode[], rootIds: string[]): CadDocument {
  const d = createEmptyDocument()
  for (const n of nodes) d.nodes[n.id] = n
  d.rootIds = rootIds
  return d
}

describe('Manifold evaluation pipeline', () => {
  it('builds a watertight 20mm box (volume 8000, 12 triangles)', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])

    const { volume, triangles } = measureSolid(M, doc, 'b')
    expect(volume).toBeCloseTo(8000, 1)
    expect(triangles).toBe(12)

    const raw = computeExportRaw(M, doc, ['b'])
    expect(raw.index.length).toBe(36) // 12 triangles * 3
    expect(raw.index.length % 3).toBe(0)
    // Centered at the origin: every coordinate within +/-10.
    for (const v of raw.position) expect(Math.abs(v)).toBeLessThanOrEqual(10.0001)
  })

  it('subtracts a cylinder from a box, reducing volume', () => {
    const doc = docOf(
      [
        {
          id: 'diff',
          kind: 'boolean',
          op: 'subtract',
          name: 'diff',
          color: '#fff',
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
          childIds: ['box', 'bore'],
        },
        prim('box', { type: 'box', size: [20, 20, 20] }),
        prim('bore', { type: 'cylinder', height: 30, radiusBottom: 5, radiusTop: 5, segments: 64 }),
      ],
      ['diff'],
    )

    const { volume } = measureSolid(M, doc, 'diff')
    // 8000 - π·5²·20 ≈ 6429
    expect(volume).toBeLessThan(7000)
    expect(volume).toBeGreaterThan(6000)
  })

  it('extrudes a sketched profile into a solid (area × height)', () => {
    const doc = docOf(
      [
        prim('ext', {
          type: 'extrusion',
          profile: [
            [
              [0, 0],
              [10, 0],
              [10, 20],
              [0, 20],
            ],
          ],
          height: 5,
        }),
      ],
      ['ext'],
    )
    // 10 × 20 rectangle, extruded 5mm → 1000 mm³
    expect(measureSolid(M, doc, 'ext').volume).toBeCloseTo(1000, 0)
  })

  it('flip extrudes to the other side of the plane (−Z instead of +Z)', () => {
    const profile: Vec2[][] = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ]
    const zRange = (raw: { position: Float32Array }) => {
      let mn = Infinity
      let mx = -Infinity
      for (let i = 2; i < raw.position.length; i += 3) {
        mn = Math.min(mn, raw.position[i])
        mx = Math.max(mx, raw.position[i])
      }
      return [mn, mx]
    }
    const up = docOf([prim('u', { type: 'extrusion', profile, height: 5 })], ['u'])
    const down = docOf([prim('d', { type: 'extrusion', profile, height: 5, flip: true })], ['d'])
    const [umn, umx] = zRange(computeExportRaw(M, up, ['u']))
    const [dmn, dmx] = zRange(computeExportRaw(M, down, ['d']))
    expect(umn).toBeCloseTo(0, 3)
    expect(umx).toBeCloseTo(5, 3)
    expect(dmn).toBeCloseTo(-5, 3)
    expect(dmx).toBeCloseTo(0, 3)
  })

  it('revolves a profile into a solid of revolution (tube volume)', () => {
    // Rectangle x∈[5,15], y∈[0,10] revolved 360° around x=0 → tube R=15, r=5, h=10.
    const doc = docOf(
      [
        prim('rev', {
          type: 'revolution',
          profile: [
            [
              [5, 0],
              [15, 0],
              [15, 10],
              [5, 10],
            ],
          ],
          degrees: 360,
          segments: 64,
        }),
      ],
      ['rev'],
    )
    // π·(15² − 5²)·10 ≈ 6283; the 64-gon facets make it slightly less.
    const vol = measureSolid(M, doc, 'rev').volume
    expect(vol).toBeGreaterThan(6000)
    expect(vol).toBeLessThan(6300)
  })

  it('extrudes text contours with even-odd holes (counter stays hollow)', () => {
    // An outer 20×20 square with a concentric 10×10 hole — the kind of nested
    // contour set a glyph counter produces. Even-odd must hollow the inner loop.
    const doc = docOf(
      [
        prim('t', {
          type: 'text',
          text: 'O',
          size: 10,
          height: 4,
          profile: [
            [
              [-10, -10],
              [10, -10],
              [10, 10],
              [-10, 10],
            ],
            [
              [-5, -5],
              [5, -5],
              [5, 5],
              [-5, 5],
            ],
          ],
        }),
      ],
      ['t'],
    )
    // (20² − 10²) × 4 = 300 × 4 = 1200; a filled square would be 1600.
    expect(measureSolid(M, doc, 't').volume).toBeCloseTo(1200, 0)
  })

  it('unions two disjoint boxes (volume ~16000)', () => {
    const doc = docOf(
      [
        prim('b1', { type: 'box', size: [20, 20, 20] }, [-20, 0, 0]),
        prim('b2', { type: 'box', size: [20, 20, 20] }, [20, 0, 0]),
      ],
      ['b1', 'b2'],
    )

    const raw = computeExportRaw(M, doc, ['b1', 'b2'])
    expect(raw.index.length).toBeGreaterThan(0)

    // Bounding box should span from -30 to +30 in X (two boxes, gap between).
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < raw.position.length; i += 3) {
      minX = Math.min(minX, raw.position[i])
      maxX = Math.max(maxX, raw.position[i])
    }
    expect(minX).toBeCloseTo(-30, 1)
    expect(maxX).toBeCloseTo(30, 1)
  })
})

/** xyz bounds of a raw mesh's positions. */
function meshBounds(pos: Float32Array) {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }
  for (let i = 0; i < pos.length; i += 3) {
    b.minX = Math.min(b.minX, pos[i])
    b.maxX = Math.max(b.maxX, pos[i])
    b.minY = Math.min(b.minY, pos[i + 1])
    b.maxY = Math.max(b.maxY, pos[i + 1])
    b.minZ = Math.min(b.minZ, pos[i + 2])
    b.maxZ = Math.max(b.maxZ, pos[i + 2])
  }
  return b
}

function container(id: string, extra: Partial<CadNode>, childIds: string[]): CadNode {
  return {
    id,
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM },
    childIds,
    ...extra,
  } as CadNode
}

describe('pattern / mirror / shell modifiers', () => {
  it('linear-patterns a box into N disjoint copies (volume × N, extended bounds)', () => {
    const doc = docOf(
      [
        container(
          'pat',
          { kind: 'pattern', spec: { mode: 'linear', count: 3, offset: [25, 0, 0] } },
          ['b'],
        ),
        prim('b', { type: 'box', size: [10, 10, 10] }),
      ],
      ['pat'],
    )
    expect(measureSolid(M, doc, 'pat').volume).toBeCloseTo(3000, 0)
    const b = meshBounds(computeExportRaw(M, doc, ['pat']).position)
    expect(b.minX).toBeCloseTo(-5, 2)
    expect(b.maxX).toBeCloseTo(55, 2) // copy 0 at 0, copy 2 at 50, +half-width
  })

  it('circular-patterns a box evenly about Z (volume × N, symmetric bounds)', () => {
    const doc = docOf(
      [
        container(
          'pat',
          {
            kind: 'pattern',
            spec: {
              mode: 'circular',
              count: 4,
              angleDeg: 360,
              axisOrigin: [0, 0, 0],
              axisDir: [0, 0, 1],
            },
          },
          ['b'],
        ),
        prim('b', { type: 'box', size: [6, 6, 6] }, [20, 0, 0]),
      ],
      ['pat'],
    )
    expect(measureSolid(M, doc, 'pat').volume).toBeCloseTo(864, 0) // 4 × 216
    const b = meshBounds(computeExportRaw(M, doc, ['pat']).position)
    expect(b.maxX).toBeCloseTo(23, 1)
    expect(b.minX).toBeCloseTo(-23, 1)
    expect(b.maxY).toBeCloseTo(23, 1)
  })

  it('mirrors a box across the x=0 plane, keeping the original (symmetric pair)', () => {
    const doc = docOf(
      [
        container(
          'm',
          {
            kind: 'pattern',
            spec: {
              mode: 'mirror',
              planeOrigin: [0, 0, 0],
              planeNormal: [1, 0, 0],
              keepOriginal: true,
            },
          },
          ['b'],
        ),
        prim('b', { type: 'box', size: [10, 10, 10] }, [10, 0, 0]),
      ],
      ['m'],
    )
    expect(measureSolid(M, doc, 'm').volume).toBeCloseTo(2000, 0)
    const b = meshBounds(computeExportRaw(M, doc, ['m']).position)
    expect(b.minX).toBeCloseTo(-15, 2)
    expect(b.maxX).toBeCloseTo(15, 2)
  })

  it('mirror without keepOriginal yields only the reflection', () => {
    const doc = docOf(
      [
        container(
          'm',
          {
            kind: 'pattern',
            spec: {
              mode: 'mirror',
              planeOrigin: [0, 0, 0],
              planeNormal: [1, 0, 0],
              keepOriginal: false,
            },
          },
          ['b'],
        ),
        prim('b', { type: 'box', size: [10, 10, 10] }, [10, 0, 0]),
      ],
      ['m'],
    )
    expect(measureSolid(M, doc, 'm').volume).toBeCloseTo(1000, 0)
    const b = meshBounds(computeExportRaw(M, doc, ['m']).position)
    expect(b.minX).toBeCloseTo(-15, 2)
    expect(b.maxX).toBeCloseTo(-5, 2)
  })

  it('shells a 20mm box to a 2mm wall (hollow volume)', () => {
    const doc = docOf(
      [
        container('s', { kind: 'shell', thickness: 2, openTop: false }, ['b']),
        prim('b', { type: 'box', size: [20, 20, 20] }),
      ],
      ['s'],
    )
    // 20³ minus 16³ inner = 8000 − 4096 = 3904.
    expect(measureSolid(M, doc, 's').volume).toBeCloseTo(3904, 0)
  })

  it('open-top shell removes the lid (less material than a closed shell)', () => {
    const closed = docOf(
      [
        container('s', { kind: 'shell', thickness: 2, openTop: false }, ['b']),
        prim('b', { type: 'box', size: [20, 20, 20] }),
      ],
      ['s'],
    )
    const open = docOf(
      [
        container('s', { kind: 'shell', thickness: 2, openTop: true }, ['b']),
        prim('b', { type: 'box', size: [20, 20, 20] }),
      ],
      ['s'],
    )
    const vClosed = measureSolid(M, closed, 's').volume
    const vOpen = measureSolid(M, open, 's').volume
    expect(vOpen).toBeLessThan(vClosed)
    expect(vOpen).toBeGreaterThan(0)
  })
})

function bounds(polys: Vec2[][]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polys)
    for (const [x, y] of p) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  return { minX, minY, maxX, maxY }
}

describe('sketch-plane sectioning (projectSceneRaw)', () => {
  it('sections a box at its mid-plane into its cross-section (not a silhouette)', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])
    // Box spans z ∈ [-10, 10]; the XY plane cuts through its middle.
    const groups = projectSceneRaw(M, doc, ['b'], worldToLocalMatrix(cardinalPlane('xy')))
    expect(groups).toHaveLength(1)
    const b = bounds(groups.flat())
    expect(b.minX).toBeCloseTo(-10, 1)
    expect(b.maxX).toBeCloseTo(10, 1)
    expect(b.minY).toBeCloseTo(-10, 1)
    expect(b.maxY).toBeCloseTo(10, 1)
  })

  it('captures a face that lies in the plane (sketch-on-a-face)', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])
    // Plane coincident with the top face (z=10): the face itself is in-plane.
    const groups = projectSceneRaw(
      M,
      doc,
      ['b'],
      worldToLocalMatrix(planeFromFace([0, 0, 10], [0, 0, 1])),
    )
    expect(groups.length).toBeGreaterThan(0)
    const b = bounds(groups.flat())
    expect(b.maxX - b.minX).toBeCloseTo(20, 1)
    expect(b.maxY - b.minY).toBeCloseTo(20, 1)
  })

  it('keeps overlapping objects as separate per-geometry outlines (not merged)', () => {
    // Two 20mm boxes overlapping in x∈[0,10]; both cross the XY plane.
    const doc = docOf(
      [
        prim('b1', { type: 'box', size: [20, 20, 20] }, [0, 0, 0]),
        prim('b2', { type: 'box', size: [20, 20, 20] }, [10, 0, 0]),
      ],
      ['b1', 'b2'],
    )
    const groups = projectSceneRaw(M, doc, ['b1', 'b2'], worldToLocalMatrix(cardinalPlane('xy')))
    // A union would merge these into one outline; per-geometry keeps two squares.
    expect(groups).toHaveLength(2)
    for (const g of groups) {
      const b = bounds(g)
      expect(b.maxX - b.minX).toBeCloseTo(20, 1)
      expect(b.maxY - b.minY).toBeCloseTo(20, 1)
    }
  })

  it('returns nothing for a plane the geometry only sits in front of / behind', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])
    // Plane 10mm above the top face — the box lies entirely behind it.
    const groups = projectSceneRaw(
      M,
      doc,
      ['b'],
      worldToLocalMatrix(planeFromFace([0, 0, 20], [0, 0, 1])),
    )
    expect(groups).toEqual([])
  })

  it('measureSolid reports the world volume of a scaled node and of a scaled ancestor', () => {
    // Regression: measureSolid used the LOCAL solid, so a scaled object showed
    // 1/8th of the volume that exports (and prints).
    const scaled = prim('b', { type: 'box', size: [20, 20, 20] })
    scaled.transform = { ...scaled.transform, scale: [2, 2, 2] }
    const doc = docOf([scaled], ['b'])
    expect(measureSolid(M, doc, 'b').volume).toBeCloseTo(64000, 0)

    // Same box, unscaled, inside a group scaled ×2: ancestors count too.
    const doc2 = docOf(
      [
        {
          id: 'g',
          kind: 'group',
          name: 'g',
          color: '#fff',
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM, scale: [2, 2, 2] },
          childIds: ['b'],
        },
        prim('b', { type: 'box', size: [20, 20, 20] }),
      ],
      ['g'],
    )
    expect(measureSolid(M, doc2, 'g').volume).toBeCloseTo(64000, 0)
    expect(measureSolid(M, doc2, 'b').volume).toBeCloseTo(64000, 0)
  })

  it('applies transform overrides to export and projection (resolved placement)', () => {
    const doc = docOf([prim('b', { type: 'box', size: [20, 20, 20] })], ['b'])
    const overrides = {
      b: { position: [50, 0, 0] as Vec3, rotationDeg: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 },
    }
    const raw = computeExportRaw(M, doc, ['b'], undefined, overrides)
    // Every vertex sits in the shifted position, not the stored one.
    for (let i = 0; i < raw.position.length; i += 3) {
      expect(raw.position[i]).toBeGreaterThanOrEqual(39.999)
    }
    // Without overrides the stored (origin) placement is used.
    const plain = computeExportRaw(M, doc, ['b'])
    let minX = Infinity
    for (let i = 0; i < plain.position.length; i += 3) minX = Math.min(minX, plain.position[i])
    expect(minX).toBeCloseTo(-10, 4)
  })

  it("honors a child's hole role inside pattern and shell nodes", () => {
    // Regression: pattern/shell flattened children to bare solids, so a hole
    // child ADDED material instead of cutting it.
    // Center-origin cylinder spanning z −20..20: cuts clean through the box.
    const bore = prim('bore', {
      type: 'cylinder',
      height: 40,
      radiusBottom: 5,
      radiusTop: 5,
      segments: 64,
    })
    bore.role = 'hole'
    const doc = docOf(
      [
        {
          id: 'pat',
          kind: 'pattern',
          name: 'pat',
          color: '#fff',
          visible: true,
          role: 'solid',
          transform: { ...IDENTITY_TRANSFORM },
          spec: { mode: 'linear', count: 2, offset: [40, 0, 0] },
          childIds: ['box', 'bore'],
        },
        prim('box', { type: 'box', size: [20, 20, 20] }),
        bore,
      ],
      ['pat'],
    )
    const { volume } = measureSolid(M, doc, 'pat')
    // Each copy: 8000 − π·5²·20 ≈ 6429; two copies ≈ 12858. The buggy union
    // behavior instead lands near 2·(8000 + bore-above-box) > 16000.
    expect(volume).toBeGreaterThan(12000)
    expect(volume).toBeLessThan(13500)
  })
})
