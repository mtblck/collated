// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { stripJpegMetadata } from './jpegClean'

const segment = (marker: number, body: string | Uint8Array) => {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body
  const out = new Uint8Array(4 + data.length)
  out.set([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff])
  out.set(data, 4)
  return out
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A real JPEG with every kind of metadata a phone or editor adds. */
const tagged = (base: Uint8Array) =>
  join(
    base.subarray(0, 2),
    segment(0xe1, 'Exif\0\0MM\0*GPS-SECRET-37.7749N'),
    segment(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>XMP-SECRET</x:xmpmeta>'),
    segment(0xed, 'Photoshop 3.0\x008BIMIPTC-SECRET'),
    segment(0xe2, 'MPF\0MPF-SECRET'),
    segment(0xfe, 'COMMENT-SECRET'),
    base.subarray(2),
    new TextEncoder().encode('TRAILER-SECRET depth map'),
  )

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1')

const hasPillow = (() => {
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const DECODED_HASH = `
import hashlib, io, sys
from PIL import Image
image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
print(image.size, hashlib.sha256(image.tobytes()).hexdigest())
`

/** A digest of the decoded pixels (EXIF orientation not applied), via Pillow. */
const pixels = (bytes: Uint8Array) =>
  execFileSync('python3', ['-c', DECODED_HASH], { input: Buffer.from(bytes) }).toString()

describe('stripJpegMetadata', () => {
  const files = ['quad-exif6.jpg', 'quad-landscape.jpg', 'quad-cmyk.jpg', 'doc-photo.jpg']

  it.each(files)('removes EXIF, XMP, IPTC, comments and trailers (%s)', (name) => {
    const out = stripJpegMetadata(tagged(fixture(name)))
    for (const secret of ['GPS', 'XMP', 'IPTC', 'MPF', 'COMMENT', 'TRAILER']) {
      expect(text(out)).not.toContain(`${secret}-SECRET`)
    }
    expect(text(out)).not.toContain('Exif\0')
    // Ends at the end-of-image marker.
    expect([...out.subarray(-2)]).toEqual([0xff, 0xd9])
  })

  it.skipIf(!hasPillow).each(files)('leaves the picture identical (%s)', (name) => {
    const original = fixture(name)
    expect(pixels(stripJpegMetadata(tagged(original)))).toBe(pixels(original))
  })

  it.skipIf(!hasPillow)('handles progressive JPEGs (several scans)', () => {
    const progressive = new Uint8Array(
      execFileSync('python3', [
        '-c',
        "import io,sys\nfrom PIL import Image\nb=io.BytesIO()\nImage.open(sys.argv[1]).save(b,'JPEG',progressive=True,quality=90)\nsys.stdout.buffer.write(b.getvalue())",
        'tests/fixtures/doc-photo.jpg',
      ]),
    )
    const out = stripJpegMetadata(tagged(progressive))
    expect(text(out)).not.toContain('SECRET')
    expect(pixels(out)).toBe(pixels(progressive))
  })

  it('keeps what decoding needs: the ICC profile and the Adobe colour marker', () => {
    const cmyk = fixture('quad-cmyk.jpg')
    const out = stripJpegMetadata(cmyk)
    expect(text(cmyk)).toContain('Adobe')
    expect(text(out)).toContain('Adobe')
    const withIcc = join(
      cmyk.subarray(0, 2),
      segment(0xe2, 'ICC_PROFILE\0\x01\x01profile'),
      cmyk.subarray(2),
    )
    expect(text(stripJpegMetadata(withIcc))).toContain('ICC_PROFILE')
  })

  it('is idempotent and leaves non-JPEG bytes alone', () => {
    const once = stripJpegMetadata(tagged(fixture('quad-exif6.jpg')))
    expect(Buffer.from(stripJpegMetadata(once)).equals(Buffer.from(once))).toBe(true)
    const png = fixture('quad-landscape.png')
    expect(stripJpegMetadata(png)).toBe(png)
  })

  it.each([
    ['with no end marker', (b: Uint8Array) => b.subarray(0, -2)],
    ['cut off mid-file', (b: Uint8Array) => b.subarray(0, 400)],
    [
      'with junk after a segment',
      (b: Uint8Array) =>
        join(
          b.subarray(0, 2),
          segment(0xe1, 'Exif\0\0GPS-SECRET'),
          new Uint8Array([0x00, 0x13, 0x37]),
          b.subarray(2),
        ),
    ],
  ])('still removes metadata from a damaged JPEG (%s)', (_name, damage) => {
    const out = stripJpegMetadata(damage(tagged(fixture('quad-landscape.jpg'))))
    expect(text(out)).not.toContain('GPS-SECRET')
    expect(text(out)).not.toContain('XMP-SECRET')
  })
})
