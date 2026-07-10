/**
 * Hash mutation-coverage tests: the structural hash is the geometry cache key,
 * so EVERY document field that affects evaluated geometry must change the
 * hash when it changes — a missed field means silently stale geometry, the
 * worst failure class in the app. This suite enumerates one mutation per
 * geometry-affecting field over a kitchen-sink document and asserts each one
 * busts the root's hash (and that cosmetic fields don't).
 */
import { describe, it, expect } from 'vitest'
import { fullHash, localHash } from './hash'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type {
  BooleanNode,
  CadDocument,
  CadNode,
  EdgeTreatmentNode,
  GroupNode,
  PatternNode,
  PrimitiveNode,
  ShellNode,
} from '../document/types'

const base = (id: string, extra: Partial<CadNode> = {}) => ({
  id,
  name: id,
  color: '#ffffff',
  visible: true,
  role: 'solid' as const,
  transform: structuredClone(IDENTITY_TRANSFORM),
  ...extra,
})

/** One document containing every node kind and every primitive type. */
function kitchenSink(): CadDocument {
  const doc = createEmptyDocument()
  const nodes: CadNode[] = [
    {
      ...base('root'),
      kind: 'group',
      childIds: [
        'box1',
        'cyl1',
        'sph1',
        'mesh1',
        'ext1',
        'rev1',
        'txt1',
        'bool1',
        'pat1',
        'sh1',
        'et1',
      ],
    } as GroupNode,
    {
      ...base('box1'),
      kind: 'primitive',
      params: { type: 'box', size: [10, 20, 30] },
    } as PrimitiveNode,
    {
      ...base('cyl1'),
      kind: 'primitive',
      params: { type: 'cylinder', height: 15, radiusBottom: 5, radiusTop: 3, segments: 32 },
    } as PrimitiveNode,
    {
      ...base('sph1'),
      kind: 'primitive',
      params: { type: 'sphere', radius: 7, segments: 24 },
    } as PrimitiveNode,
    {
      ...base('mesh1'),
      kind: 'primitive',
      params: { type: 'mesh', assetId: 'assetA' },
    } as PrimitiveNode,
    {
      ...base('ext1'),
      kind: 'primitive',
      params: {
        type: 'extrusion',
        profile: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
        ],
        height: 5,
        flip: false,
      },
    } as PrimitiveNode,
    {
      ...base('rev1'),
      kind: 'primitive',
      params: {
        type: 'revolution',
        profile: [
          [
            [1, 0],
            [4, 0],
            [4, 8],
          ],
        ],
        degrees: 270,
        segments: 48,
      },
    } as PrimitiveNode,
    {
      ...base('txt1'),
      kind: 'primitive',
      params: {
        type: 'text',
        text: 'A',
        size: 10,
        height: 3,
        profile: [
          [
            [0, 0],
            [5, 0],
            [2.5, 8],
          ],
        ],
      },
    } as PrimitiveNode,
    { ...base('bool1'), kind: 'boolean', op: 'subtract', childIds: ['bA', 'bB'] } as BooleanNode,
    { ...base('bA'), kind: 'primitive', params: { type: 'box', size: [8, 8, 8] } } as PrimitiveNode,
    {
      ...base('bB', {
        role: 'solid',
        transform: { position: [2, 2, 2], rotationDeg: [0, 45, 0], scale: [1, 1, 1] },
      }),
      kind: 'primitive',
      params: { type: 'box', size: [4, 4, 4] },
    } as PrimitiveNode,
    {
      ...base('pat1'),
      kind: 'pattern',
      spec: { mode: 'linear', count: 4, offset: [25, 0, 0] },
      childIds: ['pA'],
    } as PatternNode,
    { ...base('pA'), kind: 'primitive', params: { type: 'box', size: [5, 5, 5] } } as PrimitiveNode,
    { ...base('sh1'), kind: 'shell', thickness: 2, openTop: false, childIds: ['sA'] } as ShellNode,
    {
      ...base('sA'),
      kind: 'primitive',
      params: { type: 'box', size: [20, 20, 20] },
    } as PrimitiveNode,
    {
      ...base('et1'),
      kind: 'edgeTreatment',
      entries: [
        {
          id: 'e1',
          kind: 'fillet',
          size: 2,
          edge: {
            kind: 'line',
            point: [0, 0, 5],
            dir: [1, 0, 0],
            length: 10,
            normals: [
              [0, 0, 1],
              [0, -1, 0],
            ],
          },
        },
      ],
      childIds: ['eA'],
    } as EdgeTreatmentNode,
    {
      ...base('eA'),
      kind: 'primitive',
      params: { type: 'box', size: [10, 10, 10] },
    } as PrimitiveNode,
  ]
  for (const n of nodes) doc.nodes[n.id] = n
  doc.rootIds = ['root']
  doc.featureOrder = nodes.map((n) => n.id)
  return doc
}

type Mutation = [description: string, mutate: (doc: CadDocument) => void]

/** Typed access to a primitive's params, narrowed to the given variant. */
function prim<T extends PrimitiveNode['params']['type']>(
  doc: CadDocument,
  id: string,
  type: T,
): Extract<PrimitiveNode['params'], { type: T }> {
  const params = (doc.nodes[id] as PrimitiveNode).params
  if (params.type !== type) throw new Error(`expected ${type}, got ${params.type}`)
  return params as Extract<PrimitiveNode['params'], { type: T }>
}

/** Every entry must change the geometry — and therefore MUST change the hash. */
const GEOMETRY_MUTATIONS: Mutation[] = [
  ['box size', (d) => (prim(d, 'box1', 'box').size[2] = 31)],
  ['cylinder height', (d) => (prim(d, 'cyl1', 'cylinder').height = 16)],
  ['cylinder radiusBottom', (d) => (prim(d, 'cyl1', 'cylinder').radiusBottom = 6)],
  ['cylinder radiusTop', (d) => (prim(d, 'cyl1', 'cylinder').radiusTop = 2)],
  ['cylinder segments', (d) => (prim(d, 'cyl1', 'cylinder').segments = 12)],
  ['sphere radius', (d) => (prim(d, 'sph1', 'sphere').radius = 8)],
  ['sphere segments', (d) => (prim(d, 'sph1', 'sphere').segments = 8)],
  ['mesh assetId', (d) => (prim(d, 'mesh1', 'mesh').assetId = 'assetB')],
  ['extrusion profile point', (d) => (prim(d, 'ext1', 'extrusion').profile[0][1][0] = 11)],
  ['extrusion height', (d) => (prim(d, 'ext1', 'extrusion').height = 6)],
  ['extrusion flip', (d) => (prim(d, 'ext1', 'extrusion').flip = true)],
  ['revolution profile point', (d) => (prim(d, 'rev1', 'revolution').profile[0][2][1] = 9)],
  ['revolution degrees', (d) => (prim(d, 'rev1', 'revolution').degrees = 360)],
  ['revolution segments', (d) => (prim(d, 'rev1', 'revolution').segments = 24)],
  ['text extrude height', (d) => (prim(d, 'txt1', 'text').height = 4)],
  ['text glyph profile', (d) => (prim(d, 'txt1', 'text').profile[0][2][0] = 3)],
  ['boolean op', (d) => ((d.nodes.bool1 as BooleanNode).op = 'intersect')],
  ['boolean child order', (d) => (d.nodes.bool1 as BooleanNode).childIds.reverse()],
  ['child role solid→hole', (d) => (d.nodes.bB.role = 'hole')],
  ['child transform position', (d) => (d.nodes.bB.transform.position[0] = 3)],
  ['child transform rotation', (d) => (d.nodes.bB.transform.rotationDeg[1] = 90)],
  ['child transform scale', (d) => (d.nodes.bB.transform.scale[2] = 2)],
  [
    'pattern count',
    (d) => {
      const spec = (d.nodes.pat1 as PatternNode).spec
      if (spec.mode !== 'linear') throw new Error('expected linear pattern')
      spec.count = 5
    },
  ],
  [
    'pattern offset',
    (d) => {
      const spec = (d.nodes.pat1 as PatternNode).spec
      if (spec.mode !== 'linear') throw new Error('expected linear pattern')
      spec.offset[1] = 10
    },
  ],
  [
    'pattern mode swap',
    (d) =>
      ((d.nodes.pat1 as PatternNode).spec = {
        mode: 'circular',
        count: 4,
        angleDeg: 360,
        axisOrigin: [0, 0, 0],
        axisDir: [0, 0, 1],
      }),
  ],
  [
    'mirror keepOriginal',
    (d) => {
      const pat = d.nodes.pat1 as PatternNode
      pat.spec = {
        mode: 'mirror',
        planeOrigin: [0, 0, 0],
        planeNormal: [1, 0, 0],
        keepOriginal: true,
      }
      // baseline vs keepOriginal=false must differ:
      const other = structuredClone(d)
      const otherSpec = (other.nodes.pat1 as PatternNode).spec
      if (otherSpec.mode !== 'mirror') throw new Error('expected mirror pattern')
      otherSpec.keepOriginal = false
      expect(fullHash(d, 'root')).not.toBe(fullHash(other, 'root'))
    },
  ],
  ['shell thickness', (d) => ((d.nodes.sh1 as ShellNode).thickness = 3)],
  ['shell openTop', (d) => ((d.nodes.sh1 as ShellNode).openTop = true)],
  ['edge treatment kind', (d) => ((d.nodes.et1 as EdgeTreatmentNode).entries[0].kind = 'chamfer')],
  ['edge treatment size', (d) => ((d.nodes.et1 as EdgeTreatmentNode).entries[0].size = 3)],
  [
    'edge signature point',
    (d) => ((d.nodes.et1 as EdgeTreatmentNode).entries[0].edge.point[2] = 6),
  ],
  ['remove an edge treatment entry', (d) => ((d.nodes.et1 as EdgeTreatmentNode).entries = [])],
  [
    'remove a child from the group',
    (d) =>
      ((d.nodes.root as GroupNode).childIds = (d.nodes.root as GroupNode).childIds.filter(
        (c) => c !== 'sph1',
      )),
  ],
  ['group child order', (d) => (d.nodes.root as GroupNode).childIds.reverse()],
  ['delete a referenced node', (d) => delete d.nodes['pA']],
]

/** Cosmetic fields must NOT bust the cache. */
const COSMETIC_MUTATIONS: Mutation[] = [
  ['name', (d) => (d.nodes.box1.name = 'renamed')],
  ['color', (d) => (d.nodes.box1.color = '#ff0000')],
  ['visible', (d) => (d.nodes.box1.visible = false)],
  ["a root's own transform (localHash only)", (d) => (d.nodes.root.transform.position[0] = 99)],
]

describe('hash mutation coverage', () => {
  const baseline = kitchenSink()
  const baseFull = fullHash(baseline, 'root')
  const baseLocal = localHash(baseline, 'root')

  it.each(GEOMETRY_MUTATIONS)('geometry change busts the hash: %s', (_desc, mutate) => {
    const doc = structuredClone(baseline)
    mutate(doc)
    expect(fullHash(doc, 'root')).not.toBe(baseFull)
  })

  it.each(COSMETIC_MUTATIONS)('cosmetic change keeps the cache: %s', (_desc, mutate) => {
    const doc = structuredClone(baseline)
    mutate(doc)
    expect(localHash(doc, 'root')).toBe(baseLocal)
  })

  it('editing one subtree never busts an unrelated sibling', () => {
    const doc = structuredClone(baseline)
    const before = {
      cyl: fullHash(doc, 'cyl1'),
      bool: fullHash(doc, 'bool1'),
      pat: fullHash(doc, 'pat1'),
    }
    prim(doc, 'box1', 'box').size[0] = 99
    ;(doc.nodes.sh1 as ShellNode).thickness = 9
    expect(fullHash(doc, 'cyl1')).toBe(before.cyl)
    expect(fullHash(doc, 'bool1')).toBe(before.bool)
    expect(fullHash(doc, 'pat1')).toBe(before.pat)
  })

  it('quantization kills float noise but keeps real differences', () => {
    const a = structuredClone(baseline)
    const b = structuredClone(baseline)
    // Sub-quantum noise (1e-9 < 1e-6 quantum) — must be a cache HIT.
    b.nodes.bB.transform.position[0] = a.nodes.bB.transform.position[0] + 1e-9
    expect(fullHash(b, 'root')).toBe(fullHash(a, 'root'))
    // A real difference above the quantum — must be a MISS.
    b.nodes.bB.transform.position[0] = a.nodes.bB.transform.position[0] + 1e-3
    expect(fullHash(b, 'root')).not.toBe(fullHash(a, 'root'))
  })
})
