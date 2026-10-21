// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { orientationTurns, passthrough, readJpegInfo, readPngInfo, sniff } from './imageInfo'

describe('sniff', () => {
  it('identifies files by their bytes, not their names', () => {
    expect(sniff(fixture('quad-landscape.jpg'))).toBe('jpeg')
    expect(sniff(fixture('quad-landscape.png'))).toBe('png')
    expect(sniff(fixture('quad-landscape.webp'))).toBe('other')
    expect(sniff(new TextEncoder().encode('%PDF-1.7'))).toBe('pdf')
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')])
    expect(sniff(heic)).toBe('heic')
    expect(sniff(new Uint8Array())).toBe('other')
  })
})

describe('readJpegInfo', () => {
  it('reads the stored size, components and EXIF orientation', () => {
    expect(readJpegInfo(fixture('quad-landscape.jpg'))).toEqual({
      width: 240,
      height: 160,
      components: 3,
      orientation: 1,
    })
    expect(readJpegInfo(fixture('quad-exif6.jpg'))).toMatchObject({
      width: 160,
      height: 240,
      orientation: 6,
    })
    expect(readJpegInfo(fixture('quad-exif3.jpg'))?.orientation).toBe(3)
    expect(readJpegInfo(fixture('quad-cmyk.jpg'))?.components).toBe(4)
  })

  it('returns null for truncated or non-JPEG data rather than throwing', () => {
    const jpeg = fixture('quad-landscape.jpg')
    for (let cut = 0; cut < 200; cut += 7)
      expect(() => readJpegInfo(jpeg.subarray(0, cut))).not.toThrow()
    expect(readJpegInfo(fixture('quad-landscape.png'))).toBeNull()
  })
})

describe('orientationTurns', () => {
  it('maps rotations and rejects mirrored orientations', () => {
    expect([1, 6, 3, 8].map(orientationTurns)).toEqual([0, 1, 2, 3])
    expect([2, 4, 5, 7].map(orientationTurns)).toEqual([null, null, null, null])
  })
})

describe('readPngInfo', () => {
  it('reads IHDR', () => {
    expect(readPngInfo(fixture('quad-landscape.png'))).toEqual({
      width: 240,
      height: 160,
      bitDepth: 8,
      colorType: 2,
      interlaced: false,
    })
    expect(readPngInfo(fixture('interlaced-header.png'))?.interlaced).toBe(true)
  })
})

describe('passthrough', () => {
  it('keeps upright JPEGs and PNGs as they are', () => {
    expect(passthrough(fixture('quad-landscape.jpg'))).toEqual({
      ok: true,
      format: 'jpeg',
      storedTurns: 0,
      width: 240,
      height: 160,
    })
    expect(passthrough(fixture('quad-landscape.png'))).toMatchObject({ ok: true, format: 'png' })
  })

  it('keeps EXIF-rotated JPEGs, reporting their upright size and the turns to apply', () => {
    expect(passthrough(fixture('quad-exif6.jpg'))).toEqual({
      ok: true,
      format: 'jpeg',
      storedTurns: 1,
      width: 240,
      height: 160,
    })
    expect(passthrough(fixture('quad-exif3.jpg'))).toMatchObject({ ok: true, storedTurns: 2 })
  })

  it('sends mirrored, CMYK, interlaced and other formats to be re-encoded', () => {
    for (const name of [
      'quad-exif2.jpg',
      'quad-cmyk.jpg',
      'interlaced-header.png',
      'quad-landscape.webp',
    ]) {
      expect(passthrough(fixture(name)).ok, name).toBe(false)
    }
  })
})
