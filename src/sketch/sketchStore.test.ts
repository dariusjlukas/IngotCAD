import { beforeEach, describe, it, expect } from 'vitest'
import { useSketchStore } from './sketchStore'

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
