/**
 * Serialization round-trip property tests: seeded random documents exercising
 * every node kind, primitive type, sketch feature (arcs, corner treatments,
 * construction shapes, every constraint kind, face refs), plane definition,
 * variables, bindings, and mesh assets — serialize → deserialize must be the
 * identity. A field silently dropped here is user data lost on save.
 */
import { describe, it, expect } from 'vitest'
import { serializeDocument, deserializeDocument } from './serialization'
import { createEmptyDocument, IDENTITY_TRANSFORM } from './types'
import type {
  CadDocument,
  CadNode,
  Constraint,
  PatternSpec,
  PlaneDefinition,
  SketchSource,
  Vec3,
} from './types'

/** Deterministic PRNG (mulberry32) so failures reproduce exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomDocument(seed: number): CadDocument {
  const r = rng(seed)
  const num = (lo: number, hi: number) => lo + r() * (hi - lo)
  const int = (lo: number, hi: number) => Math.floor(num(lo, hi + 1))
  const vec3 = (): Vec3 => [num(-50, 50), num(-50, 50), num(-50, 50)]
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]

  const doc = createEmptyDocument()
  let n = 0
  const id = (prefix: string) => `${prefix}${n++}`

  const baseNode = (nid: string) => ({
    id: nid,
    name: `node ${nid}`,
    color: pick(['#ff0000', '#00ff88', '#4488ff']),
    visible: r() < 0.9,
    role: pick(['solid', 'hole'] as const),
    transform: {
      position: vec3(),
      rotationDeg: vec3(),
      scale: [num(0.5, 2), num(0.5, 2), num(0.5, 2)] as Vec3,
    },
  })

  const sketchSource = (): SketchSource => {
    const pts = ['sp0', 'sp1', 'sp2', 'spc'] as const
    const constraints: Constraint[] = [
      { id: 'c0', kind: 'coincident', a: 'sp0', b: 'sp1' },
      { id: 'c1', kind: 'horizontal', a: 'sp0', b: 'sp1' },
      { id: 'c2', kind: 'vertical', a: 'sp1', b: 'sp2' },
      { id: 'c3', kind: 'distance', a: 'sp0', b: 'sp2', value: num(1, 80), offset: num(-2, 2) },
      { id: 'c4', kind: 'equal', a: 'sp0', b: 'sp1', c: 'sp1', d: 'sp2' },
      { id: 'c5', kind: 'parallel', a: 'sp0', b: 'sp1', c: 'sp1', d: 'sp2' },
      { id: 'c6', kind: 'perpendicular', a: 'sp0', b: 'sp1', c: 'sp1', d: 'sp2' },
      { id: 'c7', kind: 'tangent', a: 'sp0', b: 'sp1', c: 'spc', shape: 'circle0' },
      {
        id: 'c8',
        kind: 'radius',
        c: 'spc',
        shape: 'circle0',
        value: num(1, 20),
        diameter: r() < 0.5,
        offset: num(0, Math.PI),
      },
      {
        id: 'c9',
        kind: 'angle',
        a: 'sp0',
        b: 'sp1',
        c: 'sp1',
        d: 'sp2',
        value: num(0, 180),
        offset: num(5, 20),
      },
    ]
    return {
      data: {
        points: Object.fromEntries(
          pts.map((p) => [p, { x: num(-40, 40), y: num(-40, 40), fixed: r() < 0.3 }]),
        ),
        shapes: [
          {
            id: 'loop0',
            kind: 'loop',
            pts: ['sp0', 'sp1', 'sp2'],
            construction: r() < 0.3,
            corners: { sp1: { kind: pick(['fillet', 'chamfer'] as const), size: num(0.5, 4) } },
            arcs: { sp0: { center: 'spc', ccw: r() < 0.5 } },
          },
          { id: 'circle0', kind: 'circle', c: 'spc', r: num(2, 15), construction: r() < 0.3 },
        ],
        constraints,
      },
      plane: { origin: vec3(), u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
      ...(r() < 0.5
        ? { faceRef: { nodeId: 'root0', normal: [0, 0, 1] as Vec3, offset: num(-10, 10) } }
        : {}),
    }
  }

  const profile = () => [
    [
      [0, 0],
      [num(5, 20), 0],
      [num(5, 20), num(5, 20)],
    ] as [number, number][],
  ]

  const primitives: (() => CadNode)[] = [
    () => ({ ...baseNode(id('p')), kind: 'primitive', params: { type: 'box', size: vec3() } }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: {
        type: 'cylinder',
        height: num(1, 40),
        radiusBottom: num(1, 10),
        radiusTop: num(0, 10),
        segments: int(3, 64),
      },
    }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: { type: 'sphere', radius: num(1, 15), segments: int(4, 48) },
    }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: { type: 'mesh', assetId: 'asset0' },
    }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: {
        type: 'extrusion',
        profile: profile(),
        height: num(1, 30),
        flip: r() < 0.5,
        sketch: sketchSource(),
      },
    }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: {
        type: 'revolution',
        profile: profile(),
        degrees: num(10, 360),
        segments: int(8, 64),
        sketch: sketchSource(),
      },
    }),
    () => ({
      ...baseNode(id('p')),
      kind: 'primitive',
      params: {
        type: 'text',
        text: 'Ingot',
        size: num(4, 20),
        height: num(1, 6),
        profile: profile(),
      },
    }),
  ]

  // A container of each kind wrapping a few random primitives.
  const makeChildren = (count: number): string[] => {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const node = pick(primitives)()
      doc.nodes[node.id] = node
      ids.push(node.id)
    }
    return ids
  }

  const containers: CadNode[] = [
    { ...baseNode('root0'), kind: 'group', childIds: makeChildren(int(1, 3)) },
    {
      ...baseNode('root1'),
      kind: 'boolean',
      op: pick(['union', 'subtract', 'intersect'] as const),
      childIds: makeChildren(2),
    },
    {
      ...baseNode('root2'),
      kind: 'pattern',
      spec: pick<PatternSpec>([
        { mode: 'linear', count: int(2, 6), offset: vec3() },
        {
          mode: 'circular',
          count: int(2, 8),
          angleDeg: num(30, 360),
          axisOrigin: vec3(),
          axisDir: [0, 0, 1],
        },
        { mode: 'mirror', planeOrigin: vec3(), planeNormal: [1, 0, 0], keepOriginal: r() < 0.5 },
      ]),
      childIds: makeChildren(1),
    },
    {
      ...baseNode('root3'),
      kind: 'shell',
      thickness: num(0.5, 4),
      openTop: r() < 0.5,
      childIds: makeChildren(1),
    },
    {
      ...baseNode('root4'),
      kind: 'edgeTreatment',
      entries: [
        {
          id: 'et0',
          kind: pick(['chamfer', 'fillet'] as const),
          size: num(0.5, 3),
          edge: {
            kind: pick(['line', 'circle'] as const),
            point: vec3(),
            dir: [0, 0, 1],
            length: num(1, 50),
            radius: num(1, 10),
            normals: [
              [0, 0, 1],
              [0, -1, 0],
            ],
          },
        },
      ],
      childIds: makeChildren(1),
    },
  ]
  for (const c of containers) doc.nodes[c.id] = c
  // A loose root primitive too.
  const loose = pick(primitives)()
  doc.nodes[loose.id] = loose
  doc.rootIds = [...containers.map((c) => c.id), loose.id]
  doc.featureOrder = Object.keys(doc.nodes)

  doc.assets.asset0 = {
    position: new Float32Array(Array.from({ length: 9 * int(1, 4) }, () => num(-30, 30))),
    index: new Uint32Array(Array.from({ length: 3 * int(1, 4) }, (_, i) => i % 9)),
  }

  const planeDefs: PlaneDefinition[] = [
    { kind: 'offset', base: pick(['xy', 'xz', 'yz'] as const), distance: num(-30, 30) },
    {
      kind: 'face',
      origin: vec3(),
      normal: [0, 0, 1],
      distance: num(-10, 10),
      source: { nodeId: 'root0', normal: [0, 0, 1], offset: num(-10, 10) },
    },
    { kind: 'threePoints', a: vec3(), b: vec3(), c: vec3() },
    {
      kind: 'edgeAngle',
      origin: vec3(),
      axis: [1, 0, 0],
      refNormal: [0, 0, 1],
      angleDeg: num(0, 180),
    },
  ]
  planeDefs.forEach((definition, i) => {
    const pid = `plane${i}`
    doc.planes[pid] = { id: pid, name: `Plane ${i}`, visible: r() < 0.8, definition }
    doc.planeOrder.push(pid)
  })

  doc.variables = [
    { name: 'wall', expr: '2.4' },
    { name: 'slot', expr: 'wall * 2 + 1' },
  ]
  doc.bindings = { [`${containers[3].id}:thickness`]: 'wall' }

  return doc
}

describe('serialization round-trip properties', () => {
  it('random kitchen-sink documents survive a round trip exactly', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const doc = randomDocument(seed)
      const back = deserializeDocument(serializeDocument(doc))
      expect(back, `seed ${seed}`).toEqual(doc)
    }
  })

  it('a round-tripped document re-serializes to identical bytes (stable form)', () => {
    const doc = randomDocument(42)
    const once = serializeDocument(doc)
    const twice = serializeDocument(deserializeDocument(once))
    expect(twice).toBe(once)
  })

  it('an empty document survives a round trip', () => {
    const doc = createEmptyDocument()
    expect(deserializeDocument(serializeDocument(doc))).toEqual(doc)
  })

  it('identity transform constant is not shared/mutated by generators', () => {
    // Guard for the test suite itself: builders must clone IDENTITY_TRANSFORM.
    expect(IDENTITY_TRANSFORM).toEqual({
      position: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      scale: [1, 1, 1],
    })
  })
})
