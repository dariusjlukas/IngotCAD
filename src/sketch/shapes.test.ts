import { describe, it, expect } from 'vitest'
import { CIRCLE_SEGMENTS, pointInShape, shapeToContour, translateShape } from './shapes'
import type { SketchShape } from './shapes'
import { distance, signedArea } from './geometry'

describe('sketch shapes', () => {
  it('rect contour is CCW with area w×h', () => {
    const rect: SketchShape = { kind: 'rect', x: 5, y: 5, w: 10, h: 20 }
    const c = shapeToContour(rect)
    expect(c).toHaveLength(4)
    expect(signedArea(c)).toBeCloseTo(200)
  })

  it('circle contour has CIRCLE_SEGMENTS points at radius r', () => {
    const circle: SketchShape = { kind: 'circle', cx: 0, cy: 0, r: 5 }
    const c = shapeToContour(circle)
    expect(c).toHaveLength(CIRCLE_SEGMENTS)
    for (const p of c) expect(distance([0, 0], p)).toBeCloseTo(5)
  })

  it('translateShape shifts each shape kind', () => {
    expect(translateShape({ kind: 'rect', x: 1, y: 2, w: 3, h: 4 }, 10, 20)).toEqual({
      kind: 'rect',
      x: 11,
      y: 22,
      w: 3,
      h: 4,
    })
    expect(translateShape({ kind: 'circle', cx: 1, cy: 2, r: 5 }, -1, -2)).toEqual({
      kind: 'circle',
      cx: 0,
      cy: 0,
      r: 5,
    })
    expect(
      translateShape(
        {
          kind: 'polygon',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
        2,
        3,
      ),
    ).toEqual({
      kind: 'polygon',
      points: [
        [2, 3],
        [3, 4],
      ],
    })
  })

  it('pointInShape hit-tests each kind', () => {
    expect(pointInShape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, [5, 5])).toBe(true)
    expect(pointInShape({ kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, [20, 5])).toBe(false)
    expect(pointInShape({ kind: 'circle', cx: 0, cy: 0, r: 5 }, [3, 0])).toBe(true)
    expect(pointInShape({ kind: 'circle', cx: 0, cy: 0, r: 5 }, [6, 0])).toBe(false)
  })
})
