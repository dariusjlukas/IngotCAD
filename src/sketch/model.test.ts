import { describe, it, expect } from 'vitest'
import { CIRCLE_SEGMENTS, constraintPoints, loopSegments, shapeContours } from './model'
import type { SketchData } from './model'
import { signedArea } from './geometry'

describe('sketch model', () => {
  it('loopSegments returns closed consecutive pairs', () => {
    expect(loopSegments(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ])
  })

  it('constraintPoints lists referenced points', () => {
    expect(constraintPoints({ id: '1', kind: 'distance', a: 'a', b: 'b', value: 5 })).toEqual([
      'a',
      'b',
    ])
    expect(constraintPoints({ id: '1', kind: 'parallel', a: 'a', b: 'b', c: 'c', d: 'd' })).toEqual(
      ['a', 'b', 'c', 'd'],
    )
  })

  it('shapeContours turns a loop into a CCW contour', () => {
    const data: SketchData = {
      points: {
        a: { x: 0, y: 0, fixed: false },
        b: { x: 10, y: 0, fixed: false },
        c: { x: 10, y: 10, fixed: false },
        d: { x: 0, y: 10, fixed: false },
      },
      shapes: [{ id: 's', kind: 'loop', pts: ['a', 'b', 'c', 'd'] }],
      constraints: [],
    }
    const contours = shapeContours(data)
    expect(contours).toHaveLength(1)
    expect(signedArea(contours[0])).toBeCloseTo(100)
  })

  it('shapeContours facets a circle', () => {
    const data: SketchData = {
      points: { c: { x: 0, y: 0, fixed: false } },
      shapes: [{ id: 's', kind: 'circle', c: 'c', r: 5 }],
      constraints: [],
    }
    const contours = shapeContours(data)
    expect(contours[0]).toHaveLength(CIRCLE_SEGMENTS)
  })
})
