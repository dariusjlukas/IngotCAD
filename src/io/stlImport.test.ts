import { describe, it, expect } from 'vitest'
import { parseStlBuffer } from './stlImport'

type Vec3 = [number, number, number]

/** Build a minimal binary STL: 80-byte header, uint32 count, 50 bytes per triangle. */
function binaryStl(triangles: Vec3[][]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50)
  const view = new DataView(buffer)
  view.setUint32(80, triangles.length, true)
  let offset = 84
  for (const tri of triangles) {
    offset += 12 // face normal (zeros; positions are all we care about)
    for (const [x, y, z] of tri) {
      view.setFloat32(offset, x, true)
      view.setFloat32(offset + 4, y, true)
      view.setFloat32(offset + 8, z, true)
      offset += 12
    }
    offset += 2 // attribute byte count
  }
  return buffer
}

describe('parseStlBuffer', () => {
  it('parses a valid STL and recenters it onto the build plate', () => {
    const raw = parseStlBuffer(
      binaryStl([
        [
          [0, 0, 5],
          [10, 0, 5],
          [0, 10, 5],
        ],
      ]),
    )
    expect(raw.index.length).toBe(3)
    // XY-centered and min-Z dropped to z=0: (0..10, 0..10, z=5) -> (±5, ±5, 0).
    expect(Array.from(raw.position)).toEqual([-5, -5, 0, 5, -5, 0, -5, 5, 0])
  })

  it('rejects an STL containing a NaN vertex', () => {
    const stl = binaryStl([
      [
        [0, 0, 0],
        [10, NaN, 0],
        [0, 10, 0],
      ],
    ])
    // Without validation the NaN poisons the bounding box and the recenter
    // translate rewrites EVERY vertex to NaN — it must throw instead.
    expect(() => parseStlBuffer(stl)).toThrow(/non-finite/)
  })

  it('rejects an STL containing an infinite vertex', () => {
    const stl = binaryStl([
      [
        [0, 0, 0],
        [10, 0, 0],
        [0, Infinity, 0],
      ],
    ])
    expect(() => parseStlBuffer(stl)).toThrow(/non-finite/)
  })
})
