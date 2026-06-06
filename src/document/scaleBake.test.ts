import { describe, it, expect } from 'vitest'
import { bakeScaleIntoParams, primitiveLocalDimensions } from './scaleBake'
import type { PrimitiveParams } from './types'

const box = (size: [number, number, number]): PrimitiveParams => ({ type: 'box', size })
const sphere = (radius: number): PrimitiveParams => ({ type: 'sphere', radius, segments: 32 })
const cylinder = (height: number, radiusBottom: number, radiusTop: number): PrimitiveParams => ({
  type: 'cylinder',
  height,
  radiusBottom,
  radiusTop,
  segments: 48,
})

describe('bakeScaleIntoParams', () => {
  it('returns null for an identity scale (nothing to bake)', () => {
    expect(bakeScaleIntoParams(box([20, 20, 20]), [1, 1, 1])).toBeNull()
  })

  it('bakes a box per-axis and resets the scale', () => {
    const r = bakeScaleIntoParams(box([20, 20, 20]), [2, 3, 4])
    expect(r).not.toBeNull()
    expect(r!.params).toEqual({ type: 'box', size: [40, 60, 80] })
    expect(r!.residualScale).toEqual([1, 1, 1])
  })

  it('clamps baked box dimensions to the minimum', () => {
    const r = bakeScaleIntoParams(box([20, 20, 20]), [0.001, 1, 1])
    expect(r!.params).toEqual({ type: 'box', size: [0.1, 20, 20] })
  })

  it('bakes a sphere under a uniform scale', () => {
    const r = bakeScaleIntoParams(sphere(12), [2, 2, 2])
    expect(r!.params).toEqual({ type: 'sphere', radius: 24, segments: 32 })
    expect(r!.residualScale).toEqual([1, 1, 1])
  })

  it('refuses to bake a sphere under a non-uniform scale (keeps the scale)', () => {
    expect(bakeScaleIntoParams(sphere(12), [2, 2, 1])).toBeNull()
  })

  it('bakes a cylinder under a uniform-XY scale (radii by X, height by Z)', () => {
    const r = bakeScaleIntoParams(cylinder(20, 10, 8), [2, 2, 3])
    expect(r!.params).toEqual({
      type: 'cylinder',
      height: 60,
      radiusBottom: 20,
      radiusTop: 16,
      segments: 48,
    })
    expect(r!.residualScale).toEqual([1, 1, 1])
  })

  it('refuses to bake a cylinder under a non-uniform-XY scale', () => {
    expect(bakeScaleIntoParams(cylinder(20, 10, 8), [2, 1, 1])).toBeNull()
  })

  it('never bakes extrusion / revolution / mesh', () => {
    const extrusion: PrimitiveParams = { type: 'extrusion', profile: [], height: 10 }
    const revolution: PrimitiveParams = {
      type: 'revolution',
      profile: [],
      degrees: 360,
      segments: 64,
    }
    const mesh: PrimitiveParams = { type: 'mesh', assetId: 'a' }
    expect(bakeScaleIntoParams(extrusion, [2, 2, 2])).toBeNull()
    expect(bakeScaleIntoParams(revolution, [2, 2, 2])).toBeNull()
    expect(bakeScaleIntoParams(mesh, [2, 2, 2])).toBeNull()
  })
})

describe('primitiveLocalDimensions', () => {
  it('returns the box size directly', () => {
    expect(primitiveLocalDimensions(box([10, 20, 30]))).toEqual([10, 20, 30])
  })

  it('returns the sphere diameter on every axis', () => {
    expect(primitiveLocalDimensions(sphere(12))).toEqual([24, 24, 24])
  })

  it('uses the larger cylinder radius for the diameter', () => {
    expect(primitiveLocalDimensions(cylinder(40, 10, 5))).toEqual([20, 20, 40])
  })

  it('uses the profile bounds for an extrusion', () => {
    const extrusion: PrimitiveParams = {
      type: 'extrusion',
      profile: [
        [
          [0, 0],
          [10, 0],
          [10, 8],
        ],
      ],
      height: 5,
    }
    expect(primitiveLocalDimensions(extrusion)).toEqual([10, 8, 5])
  })

  it('returns null for an imported mesh', () => {
    expect(primitiveLocalDimensions({ type: 'mesh', assetId: 'a' })).toBeNull()
  })
})
