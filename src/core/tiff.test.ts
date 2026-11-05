import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { sniff } from './imageInfo'
import { isPage, planPage, readTiffHeader, reshape, tiffResolution, unpackBits } from './tiff'

/** A little-endian TIFF header whose IFDs (no entries) chain as `next` says. */
const chain = (next: number[]) => {
  const bytes = new Uint8Array(8 + next.length * 6)
  const view = new DataView(bytes.buffer)
  bytes.set([0x49, 0x49, 42, 0])
  view.setUint32(4, 8, true)
  next.forEach((to, i) => {
    const at = 8 + i * 6
    view.setUint16(at, 0, true)
    view.setUint32(at + 2, to === 0 ? 0 : 8 + to * 6, true)
  })
  return bytes
}

describe('TIFF files', () => {
  it('are sniffed from their bytes, BigTIFF included', () => {
    expect(sniff(fixture('fax-g4-2pages.tif'))).toBe('tiff')
    expect(sniff(Uint8Array.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]))).toBe('tiff')
    expect(sniff(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0]))).toBe('tiff')
    expect(sniff(Uint8Array.from([0x49, 0x49, 42, 1]))).toBe('other')
  })

  it('list each page’s IFD, in order', () => {
    const header = readTiffHeader(fixture('fax-g4-2pages.tif'))
    expect(header.ok && header.offsets.length).toBe(2)
    expect(readTiffHeader(fixture('scan-lzw-300dpi.tif'))).toMatchObject({ ok: true, little: true })
  })

  it('stop where a page chain loops back, and refuse absurd page counts', () => {
    // 0 → 1 → 2 → 1 …
    const looped = readTiffHeader(chain([1, 2, 1]))
    expect(looped.ok && looped.offsets).toEqual([8, 14, 20])
    expect(readTiffHeader(chain([1, 2, 3, 0]), 1)).toEqual({ ok: false, reason: 'too-many-pages' })
    expect(readTiffHeader(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0]))).toEqual({
      ok: false,
      reason: 'bigtiff',
    })
    expect(readTiffHeader(fixture('quad-landscape.png'))).toEqual({ ok: false, reason: 'not-tiff' })
  })

  it('skip thumbnails and masks', () => {
    expect(isPage({ t256: [10], t257: [10] })).toBe(true)
    expect(isPage({ t256: [10], t257: [10], t254: [2] })).toBe(true) // a page of many
    expect(isPage({ t256: [10], t257: [10], t254: [1] })).toBe(false) // reduced resolution
    expect(isPage({ t256: [10], t257: [10], t254: [4] })).toBe(false) // transparency mask
    expect(isPage({ t254: [0] })).toBe(false)
  })
})

describe('TIFF resolution', () => {
  it('reads inches and centimetres, and ignores nonsense', () => {
    expect(tiffResolution({ t282: [[204, 1]], t283: [[98, 1]] })).toEqual({ x: 204, y: 98 })
    expect(tiffResolution({ t282: [[300, 1]], t296: [2] })).toEqual({ x: 300, y: 300 })
    const cm = tiffResolution({ t282: [[11811, 100]], t283: [[11811, 100]], t296: [3] })
    expect(cm?.x).toBeCloseTo(300, 0)
    expect(tiffResolution({ t282: [[300, 1]], t296: [1] })).toBeNull() // no unit
    expect(tiffResolution({ t282: [[1, 1]] })).toBeNull()
    expect(tiffResolution({ t282: [[300, 0]] })).toBeNull()
    expect(tiffResolution({})).toBeNull()
  })
})

describe('planning a page', () => {
  it('repeats the rows of a standard-resolution fax so its pixels are square', () => {
    expect(planPage(1728, 1100, 1, { x: 204, y: 98 })).toEqual({
      width: 1728,
      height: 2290,
      dpi: 204,
    })
  })

  it('swaps size and resolution for a page stored on its side', () => {
    expect(planPage(1100, 1728, 6, { x: 98, y: 204 })).toEqual({
      width: 1728,
      height: 2290,
      dpi: 204,
    })
    expect(planPage(400, 600, 8, null)).toEqual({ width: 600, height: 400, dpi: null })
  })
})

describe('reshaping pixels', () => {
  // 3 × 2, stored:
  //   1 2 3
  //   4 5 6
  const stored = Uint8Array.from([1, 2, 3, 4, 5, 6])
  const make = (n: number) => new Uint8Array(n)
  const upright = (orientation: number) => {
    const swap = orientation >= 5
    return Array.from(
      reshape(stored, 3, 2, orientation, { width: swap ? 2 : 3, height: swap ? 3 : 2 }, make),
    )
  }

  it('applies every TIFF orientation', () => {
    expect(upright(1)).toEqual([1, 2, 3, 4, 5, 6])
    expect(upright(2)).toEqual([3, 2, 1, 6, 5, 4])
    expect(upright(3)).toEqual([6, 5, 4, 3, 2, 1])
    expect(upright(4)).toEqual([4, 5, 6, 1, 2, 3])
    expect(upright(5)).toEqual([1, 4, 2, 5, 3, 6])
    // 6: turn clockwise to display.
    expect(upright(6)).toEqual([4, 1, 5, 2, 6, 3])
    expect(upright(7)).toEqual([6, 3, 5, 2, 4, 1])
    expect(upright(8)).toEqual([3, 6, 2, 5, 1, 4])
  })

  it('stretches by repeating rows, and leaves a plain page alone', () => {
    expect(Array.from(reshape(stored, 3, 2, 1, { width: 3, height: 4 }, make))).toEqual([
      1, 2, 3, 1, 2, 3, 4, 5, 6, 4, 5, 6,
    ])
    expect(reshape(stored, 3, 2, 1, { width: 3, height: 2 }, make)).toBe(stored)
  })

  it('unpacks 1-bit rows for either photometric', () => {
    // 10 px wide: two bytes a row, the last 6 bits padding.
    const rows = Uint8Array.from([0b10100000, 0b01000000])
    expect(Array.from(unpackBits(rows, 10, 1, false))).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 0, 1])
    expect(Array.from(unpackBits(rows, 10, 1, true))).toEqual([0, 1, 0, 1, 1, 1, 1, 1, 1, 0])
  })
})
