import { describe, expect, it } from 'vitest'
import { resolveDocument } from './resolve'
import type { MeshLookup } from './resolve'
import { createEmptyDocument, IDENTITY_TRANSFORM } from './types'
import type { CadDocument, CadNode, FaceRef, SketchPlane, Vec3 } from './types'
import type { MeshArrays } from '../geometry/edges'

/** Indexed triangle mesh of an axis-aligned box spanning [min, max]. */
function boxMesh(min: Vec3, max: Vec3): MeshArrays {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  // 8 corners; bit i selects max on axis i (x=1, y=2, z=4).
  const position: number[] = []
  for (let i = 0; i < 8; i++) {
    position.push(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0)
  }
  // CCW-outward quads per face, split into triangles.
  const quads = [
    [1, 3, 7, 5], // +x
    [0, 4, 6, 2], // -x
    [2, 6, 7, 3], // +y
    [0, 1, 5, 4], // -y
    [4, 5, 7, 6], // +z
    [0, 2, 3, 1], // -z
  ]
  const index: number[] = []
  for (const [a, b, c, d] of quads) index.push(a, b, c, a, c, d)
  return { position, index }
}

const TOP_FRAME: SketchPlane = {
  origin: [0, 0, 10],
  u: [1, 0, 0],
  v: [0, 1, 0],
  n: [0, 0, 1],
}

function extrusionNode(id: string, plane: SketchPlane, faceRef: FaceRef): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    // Committed extrusions place the plane frame as the node transform.
    transform: { ...IDENTITY_TRANSFORM, position: [...plane.origin] },
    params: {
      type: 'extrusion',
      profile: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
        ],
      ],
      height: 5,
      sketch: { data: { points: {}, shapes: [], constraints: [] }, plane, faceRef },
    },
  }
}

function sourceBox(id: string): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: structuredClone(IDENTITY_TRANSFORM),
    params: { type: 'box', size: [20, 20, 20] },
  }
}

/** Doc with source box 'src' (20³ centered) + extrusion 'ext' on its top face. */
function attachedDoc(ref: Partial<FaceRef> = {}): CadDocument {
  const doc = createEmptyDocument()
  const faceRef: FaceRef = {
    nodeId: 'src',
    normal: [0, 0, 1],
    offset: 10,
    frame: TOP_FRAME, // source at identity: local frame == world frame
    ...ref,
  }
  const src = sourceBox('src')
  const ext = extrusionNode('ext', TOP_FRAME, faceRef)
  doc.nodes.src = src
  doc.nodes.ext = ext
  doc.rootIds = ['src', 'ext']
  return doc
}

const centeredBox = boxMesh([-10, -10, -10], [10, 10, 10])
const meshesOf =
  (map: Record<string, MeshArrays>): MeshLookup =>
  (id) =>
    map[id] ?? null

describe('resolveDocument', () => {
  it('is identity when nothing moved (status ok, resolved === stored)', () => {
    const doc = attachedDoc()
    const r = resolveDocument(doc, meshesOf({ src: centeredBox }))
    const dep = r.dependents.ext
    expect(dep.status).toBe('ok')
    expect(dep.plane).toEqual(TOP_FRAME)
    expect(dep.nodeTransform).toEqual(doc.nodes.ext.transform)
    expect(r.cycles).toEqual([])
  })

  it('follows a face that moved along its normal (param edit grew the source)', () => {
    const doc = attachedDoc()
    // The box grew 3mm taller: local top face now at z=13.
    const grown = boxMesh([-10, -10, -10], [10, 10, 13])
    const dep = resolveDocument(doc, meshesOf({ src: grown })).dependents.ext
    expect(dep.status).toBe('moved')
    expect(dep.plane.origin[2]).toBeCloseTo(13, 6)
    expect(dep.plane.origin[0]).toBeCloseTo(0, 6)
    expect(dep.nodeTransform?.position[2]).toBeCloseTo(13, 6)
  })

  it('follows in-plane source translation via the attach-time frame', () => {
    const doc = attachedDoc()
    // Move the SOURCE 7mm in +x: the top face plane equation is unchanged
    // (still z=10), so only frame transport can see this motion.
    doc.nodes.src.transform = { ...doc.nodes.src.transform, position: [7, 0, 0] }
    const dep = resolveDocument(doc, meshesOf({ src: centeredBox })).dependents.ext
    expect(dep.status).toBe('moved')
    expect(dep.plane.origin).toEqual([7, 0, 10])
    expect(dep.nodeTransform?.position[0]).toBeCloseTo(7, 6)
    expect(dep.nodeTransform?.position[2]).toBeCloseTo(10, 6)
  })

  it('legacy refs (no frame) cannot see in-plane motion — status stays ok', () => {
    const doc = attachedDoc({ frame: undefined })
    doc.nodes.src.transform = { ...doc.nodes.src.transform, position: [7, 0, 0] }
    const dep = resolveDocument(doc, meshesOf({ src: centeredBox })).dependents.ext
    // Documented Stage A limitation: plane-equation-only transport.
    expect(dep.status).toBe('ok')
    expect(dep.nodeTransform).toEqual(doc.nodes.ext.transform)
  })

  it('legacy refs still follow motion along the face normal', () => {
    const doc = attachedDoc({ frame: undefined })
    const grown = boxMesh([-10, -10, -10], [10, 10, 13])
    const dep = resolveDocument(doc, meshesOf({ src: grown })).dependents.ext
    expect(dep.status).toBe('moved')
    expect(dep.nodeTransform?.position[2]).toBeCloseTo(13, 6)
  })

  it('follows source rotation (frame transport carries in-plane orientation)', () => {
    const doc = attachedDoc()
    // Rotate the source 90° about Z: top plane equation unchanged, frame turns.
    doc.nodes.src.transform = { ...doc.nodes.src.transform, rotationDeg: [0, 0, 90] }
    const dep = resolveDocument(doc, meshesOf({ src: centeredBox })).dependents.ext
    expect(dep.status).toBe('moved')
    // Local +x maps to world +y.
    expect(dep.plane.u[0]).toBeCloseTo(0, 6)
    expect(dep.plane.u[1]).toBeCloseTo(1, 6)
    expect(dep.nodeTransform?.rotationDeg[2]).toBeCloseTo(90, 4)
  })

  it('preserves a manual gizmo offset while following the face', () => {
    const doc = attachedDoc()
    // The user dragged the extrusion 5mm in +y after attaching.
    doc.nodes.ext.transform = { ...doc.nodes.ext.transform, position: [0, 5, 10] }
    const grown = boxMesh([-10, -10, -10], [10, 10, 13])
    const dep = resolveDocument(doc, meshesOf({ src: grown })).dependents.ext
    // Follows the face up 3mm, keeps the manual +y offset.
    expect(dep.nodeTransform?.position).toEqual([0, 5, 13])
  })

  it('freezes on a missing face and on a missing source', () => {
    const doc = attachedDoc()
    // Face gone: a mesh whose top sits far outside the moved tolerance.
    const shrunk = boxMesh([-10, -10, -10], [10, 10, 2])
    const gone = resolveDocument(doc, meshesOf({ src: shrunk })).dependents.ext
    expect(gone.status).toBe('missing')
    expect(gone.nodeTransform).toEqual(doc.nodes.ext.transform)

    delete doc.nodes.src
    const orphan = resolveDocument(doc, meshesOf({})).dependents.ext
    expect(orphan.status).toBe('missing')
  })

  it('freezes on an unavailable mesh (source not evaluated yet)', () => {
    const doc = attachedDoc()
    const dep = resolveDocument(doc, meshesOf({})).dependents.ext
    expect(dep.status).toBe('missing')
    expect(dep.nodeTransform).toEqual(doc.nodes.ext.transform)
  })

  it('refuses mutual-reference cycles (both frozen, reported)', () => {
    const doc = createEmptyDocument()
    doc.nodes.a = extrusionNode('a', TOP_FRAME, { nodeId: 'b', normal: [0, 0, 1], offset: 10 })
    doc.nodes.b = extrusionNode('b', TOP_FRAME, { nodeId: 'a', normal: [0, 0, 1], offset: 10 })
    doc.rootIds = ['a', 'b']
    const r = resolveDocument(doc, meshesOf({ a: centeredBox, b: centeredBox }))
    expect(r.cycles.sort()).toEqual(['a', 'b'])
    expect(r.dependents.a.status).toBe('missing')
    expect(r.dependents.b.status).toBe('missing')
  })

  it('refuses a ref whose source subtree contains the dependent', () => {
    const doc = attachedDoc()
    // Wrap src+ext in a group and point ext's ref at the GROUP: the group's
    // geometry now includes ext, so following it would be circular.
    doc.nodes.g = {
      id: 'g',
      kind: 'group',
      name: 'g',
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: structuredClone(IDENTITY_TRANSFORM),
      childIds: ['src', 'ext'],
    }
    doc.rootIds = ['g']
    const node = doc.nodes.ext
    if (node.kind === 'primitive' && node.params.type === 'extrusion' && node.params.sketch) {
      node.params.sketch.faceRef = { nodeId: 'g', normal: [0, 0, 1], offset: 10 }
    }
    const r = resolveDocument(doc, meshesOf({ g: centeredBox }))
    expect(r.cycles).toEqual(['ext'])
    expect(r.dependents.ext.status).toBe('missing')
  })

  it('composes chained attachments: a plane on a face of a following extrusion', () => {
    const doc = attachedDoc()
    // ext's own local solid: profile extruded 0..5 along local Z.
    const extMesh = boxMesh([0, 0, 0], [4, 4, 5])
    // Construction plane on ext's top face (local z=5 → world z=15).
    doc.planes.p1 = {
      id: 'p1',
      name: 'Plane 1',
      visible: true,
      definition: {
        kind: 'face',
        origin: [0, 0, 15],
        normal: [0, 0, 1],
        distance: 0,
        source: {
          nodeId: 'ext',
          normal: [0, 0, 1],
          offset: 5,
          frame: { origin: [0, 0, 5], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
        },
      },
    }
    doc.planeOrder = ['p1']

    // Grow the source box 3mm: ext follows to z=13, so p1 must land at z=18.
    const grown = boxMesh([-10, -10, -10], [10, 10, 13])
    const r = resolveDocument(doc, meshesOf({ src: grown, ext: extMesh }))
    expect(r.dependents.ext.status).toBe('moved')
    expect(r.dependents.ext.nodeTransform?.position[2]).toBeCloseTo(13, 6)
    expect(r.dependents.p1.status).toBe('moved')
    expect(r.dependents.p1.plane.origin[2]).toBeCloseTo(18, 6)
  })
})
