import { beforeEach, describe, it, expect } from 'vitest'
import { useSketchStore } from './sketchStore'
import { useOperationStore } from '../operation/operationStore'
import { IDENTITY_TRANSFORM } from '../document/types'
import type { SketchData } from './model'

const sk = () => useSketchStore.getState()

beforeEach(() => {
  sk().open()
  sk().chooseCardinal('xy')
})

describe('sketch mirror', () => {
  it('reflects the selected loop across the Y axis (x → −x)', () => {
    // A rectangle entirely in +x so the reflection lands in −x.
    sk().addRectangle(5, 0, 10, 8)
    const loop = sk().data.shapes.find((s) => s.kind === 'loop')!
    expect(loop.kind).toBe('loop')
    // Select the whole loop via one of its points.
    sk().select([{ t: 'point', id: loop.kind === 'loop' ? loop.pts[0] : '' }])

    sk().mirrorSelection('y')

    const loops = sk().data.shapes.filter((s) => s.kind === 'loop')
    expect(loops).toHaveLength(2)
    // Original spans x ∈ [5, 15]; the mirror spans x ∈ [−15, −5].
    const xsOf = (id: string) => {
      const s = sk().data.shapes.find((sh) => sh.id === id)
      if (!s || s.kind !== 'loop') return []
      return s.pts.map((pid) => sk().data.points[pid].x)
    }
    const mirrored = loops.find((l) => l.id !== loop.id)!
    const xs = xsOf(mirrored.id)
    expect(Math.min(...xs)).toBeCloseTo(-15, 6)
    expect(Math.max(...xs)).toBeCloseTo(-5, 6)
  })

  it('does nothing when nothing is selected', () => {
    sk().addCircle(0, 0, 4)
    sk().clearSelection()
    sk().mirrorSelection('x')
    expect(sk().data.shapes.filter((s) => s.kind === 'circle')).toHaveLength(1)
  })
})

describe('sketch store robustness regressions', () => {
  it('ignores non-finite dimension values instead of NaN-poisoning the sketch', () => {
    const data: SketchData = {
      points: { a: { x: 0, y: 0, fixed: false }, b: { x: 10, y: 0, fixed: false } },
      shapes: [],
      constraints: [{ id: 'd1', kind: 'distance', a: 'a', b: 'b', value: 10 }],
    }
    useSketchStore.setState({ data })
    sk().setDimensionValue('d1', Infinity) // what parseFloat('1e999') used to commit
    const after = sk().data
    expect(after.constraints[0]).toMatchObject({ value: 10 })
    for (const p of Object.values(after.points)) {
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
    }
    // And the sketch still works afterwards.
    sk().setDimensionValue('d1', 25)
    const { a, b } = sk().data.points
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(25, 1)
  })

  it('opening sketch mode cancels a pending extrude/revolve operation', () => {
    useOperationStore.getState().start({
      mode: 'extrude',
      profile: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
      transform: IDENTITY_TRANSFORM,
      segments: 64,
      value: 5,
      flip: false,
      sketch: {
        data: { points: {}, shapes: [], constraints: [] },
        plane: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] },
      },
    })
    expect(useOperationStore.getState().pending).not.toBeNull()
    // Regression: the stale confirm panel's global Enter/Escape handlers used
    // to stay live through sketch mode, committing or discarding the old op.
    sk().open()
    expect(useOperationStore.getState().pending).toBeNull()
  })
})
