// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import {
  headerSize,
  orientationTurns,
  passthrough,
  readExifDate,
  readJpegInfo,
  readPngInfo,
  sniff,
} from './imageInfo'

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

describe('headerSize', () => {
  it('reads the declared size of JPEGs and PNGs without decoding', () => {
    expect(headerSize(fixture('quad-landscape.jpg'))).toEqual({ width: 240, height: 160 })
    expect(headerSize(fixture('quad-exif6.jpg'))).toEqual({ width: 160, height: 240 })
    expect(headerSize(fixture('quad-landscape.png'))).toEqual({ width: 240, height: 160 })
    expect(headerSize(new Uint8Array())).toBeNull()
  })

  // Encoded by Pillow in every variant the browser might decode.
  const hasPillow = (() => {
    try {
      execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  const encode = (format: string, options = '') =>
    new Uint8Array(
      execFileSync('python3', [
        '-c',
        `import io,sys\nfrom PIL import Image\nb=io.BytesIO()\nImage.new('RGB',(321,123)).save(b,'${format}'${options})\nsys.stdout.buffer.write(b.getvalue())`,
      ]),
    )

  it('reads WebP, GIF and BMP sizes too', () => {
    expect(headerSize(fixture('quad-landscape.webp'))).toEqual({ width: 240, height: 160 })
  })

  it.skipIf(!hasPillow).each([
    ['lossy WebP', 'WEBP', ''],
    ['lossless WebP', 'WEBP', ', lossless=True'],
    ['GIF', 'GIF', ''],
    ['BMP', 'BMP', ''],
  ])('%s', (_name, format, options) => {
    expect(headerSize(encode(format, options))).toEqual({ width: 321, height: 123 })
  })

  it('reads HEIC sizes from the header (Safari decodes it natively)', () => {
    expect(headerSize(fixture('quad-landscape.heic'))).toEqual({ width: 240, height: 160 })
  })

  it('reads AVIF sizes, and a grid image by its full size', () => {
    // Written by Pillow with pillow-heif (CI's Pillow can't write either).
    expect(headerSize(fixture('blank-321x123.avif'))).toEqual({ width: 321, height: 123 })
    expect(headerSize(fixture('grid-1100x700.heic'))).toEqual({ width: 1100, height: 700 })
  })

  it('reads a forged huge size, so the import cap can refuse it', () => {
    // A 30-byte VP8X header claiming 16384 × 16384.
    const vp8x = new Uint8Array(30)
    vp8x.set(new TextEncoder().encode('RIFF'), 0)
    vp8x.set(new TextEncoder().encode('WEBPVP8X'), 8)
    vp8x.set([0xff, 0x3f, 0x00, 0xff, 0x3f, 0x00], 24)
    expect(headerSize(vp8x)).toEqual({ width: 16384, height: 16384 })
  })
})

describe('readExifDate', () => {
  /** A bare JPEG whose EXIF has only a DateTimeOriginal, big-endian. */
  const withDate = (date: string) => {
    const text = Array.from(`${date.padEnd(19, ' ').slice(0, 19)}\0`, (c) => c.charCodeAt(0))
    const tiff = [
      ...[0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8],
      // IFD0: one entry, the Exif IFD pointer, to offset 26.
      ...[0, 1, 0x87, 0x69, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 0],
      // Exif IFD: DateTimeOriginal, ASCII x 20 at offset 44.
      ...[0, 1, 0x90, 0x03, 0, 2, 0, 0, 0, 20, 0, 0, 0, 44, 0, 0, 0, 0],
      ...text,
    ]
    const app1 = Array.from('Exif\0\0', (c) => c.charCodeAt(0)).concat(tiff)
    const length = app1.length + 2
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...app1, 0xff, 0xd9])
  }

  it('reads DateTimeOriginal as local time', () => {
    expect(readExifDate(withDate('2024:03:09 14:05:30'))).toBe(
      new Date(2024, 2, 9, 14, 5, 30).getTime(),
    )
  })

  it('is null for an unset clock, a malformed date, no EXIF, or not a JPEG', () => {
    expect(readExifDate(withDate('0000:00:00 00:00:00'))).toBeNull()
    expect(readExifDate(withDate('yesterday'))).toBeNull()
    expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
    expect(readExifDate(fixture('quad-exif3.jpg'))).toBeNull()
    expect(readExifDate(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})
