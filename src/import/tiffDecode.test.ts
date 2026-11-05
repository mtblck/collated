// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from '@cantoo/pdf-lib'
import { unzlibSync } from 'fflate'
import { afterAll, describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { buildPdf } from '../core/pdf'
import { readGreyPng } from '../core/png'
import { decodeTiffPage, openTiff } from './tiffDecode'
import type { TiffPage, TiffResponse } from './tiffProtocol'

const buffer = (name: string) => fixture(name).slice().buffer

/** Every page of a fixture, as the worker would send them. */
const pagesOf = (name: string): TiffPage[] => {
  const opened = openTiff(buffer(name))
  if (!opened.ok || opened.type !== 'open') throw new Error(JSON.stringify(opened))
  return Array.from({ length: opened.pages }, (_, i) => {
    const answer: TiffResponse = decodeTiffPage(i)
    if (!answer.ok || answer.type !== 'page') throw new Error(JSON.stringify(answer))
    return answer.page
  })
}

/** A pixel of a 1-bit PNG page: 0 black, 1 white. */
const bitAt = (png: Uint8Array, x: number, y: number) => {
  const info = readGreyPng(png)
  if (!info) throw new Error('not a grey PNG')
  const raw = unzlibSync(info.data)
  const stride = Math.ceil(info.width / 8) + 1
  return ((raw[y * stride + 1 + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1
}

/** Red, green, blue at a pixel of an RGBA page. */
const rgbAt = (p: Extract<TiffPage, { kind: 'rgba' }>, x: number, y: number) => {
  const i = (y * p.width + x) * 4
  return [p.pixels[i], p.pixels[i + 1], p.pixels[i + 2]]
}

describe('decoding TIFF pages (#113)', () => {
  it('gives a multi-page G4 fax as 1-bit pages, in order, with its resolution', () => {
    const pages = pagesOf('fax-g4-2pages.tif')
    expect(pages.map((p) => [p.kind, p.width, p.height, p.dpi])).toEqual([
      ['png', 1728, 2290, 204],
      ['png', 1728, 2290, 204],
    ])
    const [first, second] = pages as [TiffPage & { kind: 'png' }, TiffPage & { kind: 'png' }]
    expect(readGreyPng(first.bytes)?.bitDepth).toBe(1)
    // Page 1's square is at the top left, page 2's at the bottom right.
    expect(bitAt(first.bytes, 100, 100)).toBe(0)
    expect(bitAt(first.bytes, 1728 - 100, 2290 - 100)).toBe(1)
    expect(bitAt(second.bytes, 100, 100)).toBe(1)
    expect(bitAt(second.bytes, 1728 - 100, 2290 - 100)).toBe(0)
    // Black and white stays small: a fax page is a few kilobytes.
    expect(first.bytes.byteLength).toBeLessThan(20_000)
  })

  it('reads a WhiteIsZero G3 fax and makes its tall dots square', () => {
    const [fax] = pagesOf('fax-g3-normal.tif') as [TiffPage & { kind: 'png' }]
    // 1100 rows at 98 dpi become 2290 at 204, so the page is 8.47 × 11.2 in.
    expect([fax.kind, fax.width, fax.height, fax.dpi]).toEqual(['png', 1728, 2290, 204])
    expect(bitAt(fax.bytes, 150, 200)).toBe(0)
    expect(bitAt(fax.bytes, 10, 10)).toBe(1)
  })

  it('reads LZW (with predictor) and JPEG-compressed colour, and DPI in centimetres', () => {
    const [lzw] = pagesOf('scan-lzw-300dpi.tif') as [TiffPage & { kind: 'rgba' }]
    expect([lzw.kind, lzw.width, lzw.height, lzw.dpi]).toEqual(['rgba', 600, 400, 300])
    expect(rgbAt(lzw, 50, 50)).toEqual([220, 30, 30])
    expect(rgbAt(lzw, 550, 350)).toEqual([240, 200, 20])

    const [jpeg] = pagesOf('scan-jpeg-150dpi.tif') as [TiffPage & { kind: 'rgba' }]
    expect([jpeg.kind, jpeg.width, jpeg.height]).toEqual(['rgba', 600, 400])
    expect(jpeg.dpi).toBeCloseTo(150, 1)
    const [r = 0, g = 0, b = 0] = rgbAt(jpeg, 550, 350)
    expect(Math.abs(r - 240) + Math.abs(g - 200) + Math.abs(b - 20)).toBeLessThan(20)
  })

  it('explains files it can’t read', () => {
    expect(openTiff(Uint8Array.from([0x49, 0x49, 43, 0, 8, 0, 0, 0]).buffer)).toMatchObject({
      ok: false,
      reason: 'bigtiff',
    })
    // A header pointing at an IFD with no entries: nothing that is a page.
    const empty = Uint8Array.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(openTiff(empty.buffer)).toMatchObject({ ok: false, reason: 'no-pages' })
  })

  it('refuses more than 500 pages', () => {
    // 501 IFDs, each a 1 × 1 page (ImageWidth, ImageLength), chained.
    const pages = 501
    const bytes = new Uint8Array(8 + pages * 30)
    const view = new DataView(bytes.buffer)
    bytes.set([0x49, 0x49, 42, 0])
    view.setUint32(4, 8, true)
    for (let i = 0; i < pages; i++) {
      const at = 8 + i * 30
      view.setUint16(at, 2, true)
      for (const [k, id] of [256, 257].entries()) {
        const entry = at + 2 + k * 12
        view.setUint16(entry, id, true)
        view.setUint16(entry + 2, 3, true) // SHORT
        view.setUint32(entry + 4, 1, true)
        view.setUint16(entry + 8, 1, true)
      }
      view.setUint32(at + 26, i === pages - 1 ? 0 : at + 30, true)
    }
    expect(openTiff(bytes.buffer)).toMatchObject({ ok: false, reason: 'too-many-pages' })
  })

  it('refuses a page over the pixel cap from its tags, before decoding', () => {
    const bytes = fixture('fax-g3-normal.tif').slice()
    // Rewrite ImageWidth (tag 256, SHORT or LONG) to something huge.
    const view = new DataView(bytes.buffer)
    const ifd = view.getUint32(4, true)
    for (let i = 0; i < view.getUint16(ifd, true); i++) {
      const entry = ifd + 2 + i * 12
      if (view.getUint16(entry, true) !== 256) continue
      view.setUint16(entry + 2, 4, true)
      view.setUint32(entry + 8, 200_000, true)
    }
    expect(openTiff(bytes.buffer)).toMatchObject({ ok: true, pages: 1 })
    expect(decodeTiffPage(0)).toMatchObject({ ok: false, tooLarge: { width: 200_000 } })
  })
})

const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

describe('a fax page in the PDF (#113)', () => {
  const work = mkdtempSync(join(tmpdir(), 'collated-tiff-'))
  afterAll(() => {
    rmSync(work, { recursive: true, force: true })
  })

  const build = async () => {
    const [fax] = pagesOf('fax-g3-normal.tif') as [TiffPage & { kind: 'png' }]
    const meta = asset('fax', {
      format: 'png',
      width: fax.width,
      height: fax.height,
      byteLength: fax.bytes.byteLength,
      ...(fax.dpi ? { dpi: fax.dpi } : {}),
    })
    const bytes = await buildPdf(
      { settings: settings({ size: 'image' }), pages: [page('p', 'fax')], assets: { fax: meta } },
      { getBytes: () => fax.bytes, now: new Date('2026-11-05T12:00:00Z') },
    )
    return { bytes, fax }
  }

  it('stays 1-bit and about the size of the page’s PNG, on paper of the scanned size', async () => {
    const { bytes, fax } = await build()
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text).toContain('/BitsPerComponent 1')
    expect(text).toContain('/ColorSpace /DeviceGray')
    expect(bytes.byteLength).toBeLessThan(fax.bytes.byteLength + 4000)
    const [pdfPage] = (await PDFDocument.load(bytes)).getPages()
    // 1728 × 2290 dots at 204 dpi: 8.47 × 11.23 in.
    expect(pdfPage?.getWidth()).toBeCloseTo((1728 / 204) * 72, 1)
    expect(pdfPage?.getHeight()).toBeCloseTo((2290 / 204) * 72, 1)
  })

  it.skipIf(!hasPdftoppm)('prints black where the fax is black, the right way up', async () => {
    const { bytes } = await build()
    const pdfPath = join(work, 'fax.pdf')
    writeFileSync(pdfPath, bytes)
    execFileSync('pdftoppm', ['-r', '51', '-gray', '-singlefile', pdfPath, join(work, 'fax')])
    const pgm = readFileSync(join(work, 'fax.pgm'))
    const header = pgm.subarray(0, 40).toString('latin1').split(/\s+/)
    const w = Number(header[1])
    const offset = pgm.indexOf('255\n', 0, 'latin1') + 4
    // 51 dpi is a quarter of 204: fax dot (x, y) lands near (x / 4, y / 4).
    const grey = (x: number, y: number) => pgm[offset + Math.round(y / 4) * w + Math.round(x / 4)]
    expect(grey(150, 150)).toBeLessThan(40) // inside the square
    expect(grey(10, 10)).toBeGreaterThan(215) // margin
    expect(grey(1600, 2200)).toBeGreaterThan(215)
  })
})
