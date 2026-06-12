/** Edge chamfer/fillet: detection-driven cut tools, verified by volume (real WASM). */
import { describe, it, expect, beforeAll } from 'vitest'
import Module from 'manifold-3d'
import type { ManifoldToplevel } from 'manifold-3d'
import { evaluateLocal } from './evaluate'
import { detectFeatureEdges, matchEdge } from '../geometry/edges'
import type { EvalWarning } from './protocol'
import { createEmptyDocument, IDENTITY_TRANSFORM } from '../document/types'
import type {
  CadDocument,
  CadNode,
  EdgeSignature,
  EdgeTreatmentEntry,
  PrimitiveParams,
} from '../document/types'

let M: ManifoldToplevel

beforeAll(async () => {
  M = await Module()
  M.setup()
})

function prim(id: string, params: PrimitiveParams): CadNode {
  return {
    id,
    kind: 'primitive',
    name: id,
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM },
    params,
  }
}

function docWithTreatment(
  child: CadNode,
  entries: EdgeTreatmentEntry[],
): { doc: CadDocument; id: string } {
  const doc = createEmptyDocument()
  doc.nodes[child.id] = child
  doc.nodes.et = {
    id: 'et',
    kind: 'edgeTreatment',
    name: 'Chamfer/Fillet',
    entries,
    childIds: [child.id],
    color: '#fff',
    visible: true,
    role: 'solid',
    transform: { ...IDENTITY_TRANSFORM },
  }
  doc.rootIds = ['et']
  return { doc, id: 'et' }
}

/** Detected signature of the box edge nearest +X+Y (vertical edge of a cube). */
function boxEdgeSignature(size: number): EdgeSignature {
  const doc = createEmptyDocument()
  doc.nodes.b = prim('b', { type: 'box', size: [size, size, size] })
  doc.rootIds = ['b']
  const solid = evaluateLocal(M, doc, 'b')
  const mesh = solid.getMesh()
  const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
  solid.delete()
  // The vertical edge at x = y = size/2.
  const target = edges.find(
    (e) =>
      e.kind === 'line' &&
      Math.abs(e.signature.point[0] - size / 2) < 1e-3 &&
      Math.abs(e.signature.point[1] - size / 2) < 1e-3,
  )
  expect(target).toBeDefined()
  return target!.signature
}

describe('feature edge detection on real solids', () => {
  it('finds 12 convex line edges on a cube', () => {
    const doc = createEmptyDocument()
    doc.nodes.b = prim('b', { type: 'box', size: [20, 20, 20] })
    doc.rootIds = ['b']
    const solid = evaluateLocal(M, doc, 'b')
    const mesh = solid.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    solid.delete()
    expect(edges).toHaveLength(12)
    expect(edges.every((e) => e.kind === 'line' && e.convex)).toBe(true)
  })

  it('finds 2 closed circle edges on a cylinder', () => {
    const doc = createEmptyDocument()
    doc.nodes.c = prim('c', {
      type: 'cylinder',
      height: 10,
      radiusBottom: 5,
      radiusTop: 5,
      segments: 48,
    })
    doc.rootIds = ['c']
    const solid = evaluateLocal(M, doc, 'c')
    const mesh = solid.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    solid.delete()
    const circles = edges.filter((e) => e.kind === 'circle')
    expect(circles).toHaveLength(2)
    for (const c of circles) {
      expect(c.closed).toBe(true)
      expect(c.radius!).toBeCloseTo(5, 1)
      expect(Math.abs(c.axis![2])).toBeCloseTo(1, 3)
    }
  })

  it('marks the interior edge of an L-shape as concave', () => {
    // L = box minus a corner box; the inner vertical edge is concave.
    const doc = createEmptyDocument()
    doc.nodes.a = prim('a', { type: 'box', size: [20, 20, 20] })
    doc.nodes.b = {
      ...prim('b', { type: 'box', size: [10, 10, 20.2] }),
      transform: { ...IDENTITY_TRANSFORM, position: [5, 5, 0] },
      role: 'hole' as const,
    }
    doc.nodes.g = {
      id: 'g',
      kind: 'group',
      name: 'g',
      childIds: ['a', 'b'],
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM },
    }
    doc.rootIds = ['g']
    const solid = evaluateLocal(M, doc, 'g')
    const mesh = solid.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    solid.delete()
    const concave = edges.filter((e) => !e.convex)
    expect(concave.length).toBeGreaterThan(0)
  })
})

describe('edgeTreatment evaluation', () => {
  it('chamfer on one cube edge removes s²/2·L of material', () => {
    const size = 20
    const s = 3
    const sig = boxEdgeSignature(size)
    const { doc, id } = docWithTreatment(prim('b', { type: 'box', size: [size, size, size] }), [
      { id: 'e1', kind: 'chamfer', size: s, edge: sig },
    ])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    expect(solid.numTri()).toBeGreaterThan(0)
    solid.delete()
    expect(warnings).toHaveLength(0)
    expect(volume).toBeCloseTo(size ** 3 - (s * s * size) / 2, 0)
  })

  it('fillet on one cube edge removes r²(1−π/4)·L of material', () => {
    const size = 20
    const r = 4
    const sig = boxEdgeSignature(size)
    const { doc, id } = docWithTreatment(prim('b', { type: 'box', size: [size, size, size] }), [
      { id: 'e1', kind: 'fillet', size: r, edge: sig },
    ])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    solid.delete()
    expect(warnings).toHaveLength(0)
    const expected = size ** 3 - r * r * (1 - Math.PI / 4) * size
    // ~1% tolerance for the tessellated fillet cylinder.
    expect(Math.abs(volume - expected) / expected).toBeLessThan(0.01)
  })

  it('chamfer on a cylinder rim removes a Pappus ring of material', () => {
    const R = 10
    const h = 10
    const s = 2
    // Signature of the top rim.
    const cyl = prim('c', {
      type: 'cylinder',
      height: h,
      radiusBottom: R,
      radiusTop: R,
      segments: 64,
    })
    const probe = createEmptyDocument()
    probe.nodes.c = cyl
    probe.rootIds = ['c']
    const sBase = evaluateLocal(M, probe, 'c')
    const mesh = sBase.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    const baseVolume = sBase.volume()
    sBase.delete()
    const rim = edges.find((e) => e.kind === 'circle' && e.center![2] > h / 2 - 1e-3)
    expect(rim).toBeDefined()

    const { doc, id } = docWithTreatment(cyl, [
      { id: 'e1', kind: 'chamfer', size: s, edge: rim!.signature },
    ])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    solid.delete()
    expect(warnings).toHaveLength(0)
    // Pappus: removed triangular ring ≈ (s²/2) · 2π(R − s/3).
    const removed = ((s * s) / 2) * 2 * Math.PI * (R - s / 3)
    expect(Math.abs(baseVolume - removed - volume) / volume).toBeLessThan(0.02)
  })

  it('an unmatched signature warns and leaves the volume unchanged', () => {
    const size = 20
    const k = 1 / Math.sqrt(3)
    // A diagonal direction no box edge has — not even the unique-rematch
    // fallback can bind this.
    const sig: EdgeSignature = {
      kind: 'line',
      point: [500, 500, 500],
      dir: [k, k, k],
      length: 10,
      normals: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    }
    const { doc, id } = docWithTreatment(prim('b', { type: 'box', size: [size, size, size] }), [
      { id: 'e1', kind: 'chamfer', size: 2, edge: sig },
    ])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    solid.delete()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].code).toBe('edge-unmatched')
    expect(warnings[0].nodeId).toBe(id)
    expect(volume).toBeCloseTo(size ** 3, 3)
  })

  it('matching survives a child size change (containment match)', () => {
    const sig = boxEdgeSignature(20)
    // Same box but taller: the picked vertical edge is longer now.
    const doc = createEmptyDocument()
    doc.nodes.b = prim('b', { type: 'box', size: [20, 20, 40] })
    doc.rootIds = ['b']
    const solid = evaluateLocal(M, doc, 'b')
    const mesh = solid.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    solid.delete()
    const match = matchEdge(sig, edges)
    expect(match).not.toBeNull()
    expect(match!.edge.kind).toBe('line')
  })

  // L-shape (20³ box minus the x>0 ∧ y>0 quadrant): the interior vertical edge
  // at (0,0), length 20, is concave. Base volume = 8000 − 10·10·20 = 6000.
  function lShapeParts(): { nodes: Record<string, CadNode>; childIds: string[] } {
    return {
      nodes: {
        a: prim('a', { type: 'box', size: [20, 20, 20] }),
        b: {
          ...prim('b', { type: 'box', size: [10, 10, 20.2] }),
          transform: { ...IDENTITY_TRANSFORM, position: [5, 5, 0] },
          role: 'hole' as const,
        },
      },
      childIds: ['a', 'b'],
    }
  }

  function concaveEdgeSignature(): EdgeSignature {
    const doc = createEmptyDocument()
    const parts = lShapeParts()
    Object.assign(doc.nodes, parts.nodes)
    doc.nodes.g = {
      id: 'g',
      kind: 'group',
      name: 'g',
      childIds: parts.childIds,
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM },
    }
    doc.rootIds = ['g']
    const solid = evaluateLocal(M, doc, 'g')
    const mesh = solid.getMesh()
    const edges = detectFeatureEdges({ position: mesh.vertProperties, index: mesh.triVerts })
    solid.delete()
    const target = edges.find(
      (e) =>
        e.kind === 'line' &&
        !e.convex &&
        Math.abs(e.signature.point[0]) < 1e-3 &&
        Math.abs(e.signature.point[1]) < 1e-3,
    )
    expect(target).toBeDefined()
    return target!.signature
  }

  function docWithLTreatment(entries: EdgeTreatmentEntry[]): { doc: CadDocument; id: string } {
    const doc = createEmptyDocument()
    const parts = lShapeParts()
    Object.assign(doc.nodes, parts.nodes)
    doc.nodes.et = {
      id: 'et',
      kind: 'edgeTreatment',
      name: 'Chamfer/Fillet',
      entries,
      childIds: parts.childIds,
      color: '#fff',
      visible: true,
      role: 'solid',
      transform: { ...IDENTITY_TRANSFORM },
    }
    doc.rootIds = ['et']
    return { doc, id: 'et' }
  }

  it('concave chamfer fills the inside corner with s²/2·L of material', () => {
    const s = 3
    const sig = concaveEdgeSignature()
    const { doc, id } = docWithLTreatment([{ id: 'e1', kind: 'chamfer', size: s, edge: sig }])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    solid.delete()
    expect(warnings).toHaveLength(0)
    expect(volume).toBeCloseTo(6000 + (s * s * 20) / 2, 0)
  })

  it('concave fillet fills the inside corner with r²(1−π/4)·L of material', () => {
    const r = 4
    const sig = concaveEdgeSignature()
    const { doc, id } = docWithLTreatment([{ id: 'e1', kind: 'fillet', size: r, edge: sig }])
    const warnings: EvalWarning[] = []
    const solid = evaluateLocal(M, doc, id, (w) => warnings.push(w))
    const volume = solid.volume()
    solid.delete()
    expect(warnings).toHaveLength(0)
    const expected = 6000 + r * r * (1 - Math.PI / 4) * 20
    expect(Math.abs(volume - expected) / expected).toBeLessThan(0.01)
  })
})
