// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from '@cantoo/pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { layoutPage } from './geometry'
import type { Asset, Page, Settings } from './model'
import { passthrough } from './imageInfo'
import { pdfFilename } from './filename'
import { buildPdf, pageTurns, placement, visibleBox } from './pdf'

const NOW = new Date('2026-10-21T12:00:00Z')

/**
 * An asset backed by a real fixture file, sized from its own header. A PDF is
 * named `file.pdf#n` for its n-th page (from 0), sized as pdf.js would show
 * it: the visible box, turned by /Rotate.
 */
const fileAsset = async (key: string): Promise<{ meta: Asset; bytes: Uint8Array }> => {
  const [name = key, pageIndex] = key.split('#')
  const bytes = fixture(name)
  if (name.endsWith('.pdf')) {
    const src = await PDFDocument.load(bytes, { password: '' })
    const srcPage = src.getPage(Number(pageIndex ?? 0))
    const box = visibleBox(srcPage)
    const turns = pageTurns(srcPage)
    const w = box.right - box.left
    const h = box.top - box.bottom
    return {
      bytes,
      meta: asset(key, {
        bytesId: name,
        pdfPage: Number(pageIndex ?? 0),
        format: 'pdf',
        storedTurns: turns,
        width: turns % 2 ? h : w,
        height: turns % 2 ? w : h,
      }),
    }
  }
  const info = passthrough(bytes)
  if (!info.ok) throw new Error(`${name} is not passthrough`)
  return {
    bytes,
    meta: asset(key, {
      width: info.width,
      height: info.height,
      format: info.format,
      storedTurns: info.storedTurns,
    }),
  }
}

const build = async (s: Settings, items: { file: string; page?: Partial<Page> }[]) => {
  const files = new Map(
    await Promise.all(items.map(async ({ file }) => [file, await fileAsset(file)] as const)),
  )
  const assets = Object.fromEntries([...files].map(([k, v]) => [k, v.meta]))
  const bytesById = new Map([...files.values()].map((v) => [v.meta.bytesId, v.bytes]))
  const pages = items.map(({ file, page: p }, i) => page(`p${i}`, file, p))
  const bytes = await buildPdf(
    { settings: s, pages, assets },
    {
      getBytes: (id) => bytesById.get(id) ?? new Uint8Array(),
      // Stands in for the worker's canvas: returns the upright original, so
      // placement (not pixels) is what's under test.
      filterImage: () => Promise.resolve({ bytes: fixture('quad-landscape.png'), format: 'png' }),
      now: NOW,
    },
  )
  return { bytes, assets, pages }
}

describe('buildPdf', () => {
  it('makes one page per page, at the laid-out size, with metadata', async () => {
    const { bytes } = await build(
      settings({ size: 'letter', orientation: 'auto', title: 'Tax 2026' }),
      [
        { file: 'quad-landscape.jpg' },
        { file: 'quad-portrait.jpg' },
        { file: 'quad-landscape.png', page: { turns: 1 } },
      ],
    )
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [792, 612],
      [612, 792],
      [612, 792],
    ])
    expect(pdf.getTitle()).toBe('Tax 2026')
    expect(pdf.getCreator()).toBe('Collated')
  })

  it('embeds a JPEG byte-for-byte instead of re-encoding it', async () => {
    const jpeg = fixture('quad-landscape.jpg')
    const { bytes } = await build(settings(), [{ file: 'quad-landscape.jpg' }])
    expect(Buffer.from(bytes).includes(Buffer.from(jpeg))).toBe(true)
  })

  it('embeds a shared image once when a page is duplicated', async () => {
    const one = await build(settings(), [{ file: 'quad-landscape.jpg' }])
    const two = await build(settings(), [
      { file: 'quad-landscape.jpg' },
      { file: 'quad-landscape.jpg' },
    ])
    // A second copy of the image would add its full size again.
    expect(two.bytes.length - one.bytes.length).toBeLessThan(
      fixture('quad-landscape.jpg').length / 2,
    )
  })

  it('fails clearly when a page has no image', async () => {
    await expect(
      buildPdf(
        { settings: settings(), pages: [page('p', 'missing')], assets: {} },
        { getBytes: () => new Uint8Array() },
      ),
    ).rejects.toThrow(/Page 1/)
  })

  it('embeds PDF pages as vectors, parsing a shared source once', async () => {
    const { bytes } = await build(settings(), [
      { file: 'quad-3pages.pdf#0' },
      { file: 'quad-3pages.pdf#2' },
      { file: 'quad-landscape.jpg' },
    ])
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(3)
    // No raster image was made from the PDF pages: only the JPEG is an image.
    expect(
      Buffer.from(bytes)
        .toString('latin1')
        .match(/\/Subtype\s*\/Image/g),
    ).toHaveLength(1)
  })

  it('runs filtered images through filterImage once per image and filter', async () => {
    const { meta, bytes } = await fileAsset('quad-landscape.jpg')
    const calls: string[] = []
    const out = await buildPdf(
      {
        settings: settings(),
        pages: [
          page('a', meta.id, { filter: 'grey' }),
          page('b', meta.id, { filter: 'grey' }),
          page('c', meta.id, { filter: 'bw' }),
          page('d', meta.id),
        ],
        assets: { [meta.id]: meta },
      },
      {
        getBytes: () => bytes,
        filterImage: (_bytes, filter) => {
          calls.push(filter)
          return Promise.resolve({ bytes: fixture('quad-landscape.png'), format: 'png' })
        },
      },
    )
    expect(calls).toEqual(['grey', 'bw'])
    // Original JPEG still passes through for the unfiltered page.
    expect(Buffer.from(out).includes(Buffer.from(bytes))).toBe(true)
  })

  it('fails clearly if a page needs a filter and none is available', async () => {
    const { meta, bytes } = await fileAsset('quad-landscape.jpg')
    await expect(
      buildPdf(
        {
          settings: settings(),
          pages: [page('a', meta.id, { filter: 'bw' })],
          assets: { [meta.id]: meta },
        },
        { getBytes: () => bytes },
      ),
    ).rejects.toThrow(/filters/)
  })

  it('reports progress per page', async () => {
    const seen: number[] = []
    const { meta, bytes } = await fileAsset('quad-landscape.jpg')
    await buildPdf(
      {
        settings: settings(),
        pages: [page('a', meta.id), page('b', meta.id)],
        assets: { [meta.id]: meta },
      },
      { getBytes: () => bytes, onProgress: (done) => seen.push(done) },
    )
    expect(seen).toEqual([1, 2])
  })
})

describe('placement', () => {
  it('puts an unrotated image’s corner at bottom-left of its box in PDF space', () => {
    const layout = layoutPage(
      settings({ size: 'letter', orientation: 'portrait' }),
      asset('a', { width: 200, height: 100 }),
      page('p', 'a'),
    )
    const at = placement(layout, 0)
    expect(at.x).toBeCloseTo(0)
    expect(at.y).toBeCloseTo(396 - 153)
    expect(at.rotate).toBeCloseTo(0)
  })

  it('swaps the stored size for a sideways-stored JPEG', () => {
    const layout = layoutPage(settings(), asset('a', { width: 200, height: 100 }), page('p', 'a'))
    const at = placement(layout, 1)
    expect(at.width).toBeCloseTo(layout.image.height)
    expect(at.height).toBeCloseTo(layout.image.width)
    expect(at.rotate).toBeCloseTo(-90)
  })
})

describe('pdfFilename', () => {
  it('slugs the title and falls back to a dated name', () => {
    expect(pdfFilename('Tax return — 2026 (signed)')).toBe('Tax-return-2026-signed.pdf')
    expect(pdfFilename('Café receipts.pdf')).toBe('Cafe-receipts.pdf')
    expect(pdfFilename('   ', NOW)).toBe('scans-2026-10-21.pdf')
  })
})

/*
 * The real test of the geometry: render the exported PDF with poppler and
 * check that each coloured quadrant of the image lands where the layout (and
 * therefore the on-screen preview) says it should. Skipped if pdftoppm isn't
 * installed; CI installs it.
 */
const hasPdftoppm = (() => {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

// Quadrant centres catch rotation; points near each corner catch content that
// is the wrong size or offset (e.g. a PDF's media box embedded instead of its
// crop box), which can leave the centres looking right.
const QUADRANTS = {
  tl: { at: [0.25, 0.25], rgb: [220, 30, 30] },
  tr: { at: [0.75, 0.25], rgb: [30, 170, 60] },
  bl: { at: [0.25, 0.75], rgb: [30, 60, 220] },
  br: { at: [0.75, 0.75], rgb: [240, 200, 20] },
  'tl corner': { at: [0.06, 0.06], rgb: [220, 30, 30] },
  'tr corner': { at: [0.94, 0.06], rgb: [30, 170, 60] },
  'bl corner': { at: [0.06, 0.94], rgb: [30, 60, 220] },
  'br corner': { at: [0.94, 0.94], rgb: [240, 200, 20] },
} as const

const DPI = 36 // 0.5 px per point
const work = mkdtempSync(join(tmpdir(), 'collated-raster-'))
afterAll(() => {
  rmSync(work, { recursive: true, force: true })
})

/** Renders page 1 and returns a pixel reader in PDF points (top-left origin). */
const rasterise = (bytes: Uint8Array) => {
  const pdfPath = join(work, `${String(Math.random()).slice(2)}.pdf`)
  writeFileSync(pdfPath, bytes)
  const prefix = pdfPath.replace(/\.pdf$/, '')
  execFileSync('pdftoppm', [
    '-r',
    String(DPI),
    '-f',
    '1',
    '-l',
    '1',
    '-singlefile',
    pdfPath,
    prefix,
  ])
  const file = readdirSync(work).find((f) => join(work, f).startsWith(prefix) && f.endsWith('.ppm'))
  if (!file) throw new Error('pdftoppm produced nothing')
  const ppm = readFileSync(join(work, file))
  // P6\n<w> <h>\n255\n<rgb...>
  const header = ppm.subarray(0, 50).toString('latin1').split(/\s+/)
  const w = Number(header[1])
  const offset = ppm.indexOf('255\n', 0, 'latin1') + 4
  return (xPt: number, yPt: number) => {
    const x = Math.round((xPt * DPI) / 72)
    const y = Math.round((yPt * DPI) / 72)
    const i = offset + (y * w + x) * 3
    return [ppm[i], ppm[i + 1], ppm[i + 2]] as number[]
  }
}

const close = (a: readonly number[], b: readonly number[]) =>
  a.every((v, i) => Math.abs(v - (b[i] ?? 0)) < 40)

describe.skipIf(!hasPdftoppm)('rendered output matches the layout', () => {
  const cases: { name: string; file: string; s?: Partial<Settings>; p?: Partial<Page> }[] = [
    // The filter fake returns an upright PNG; EXIF turns must not apply twice.
    { name: 'filtered EXIF 6 photo', file: 'quad-exif6.jpg', p: { filter: 'grey', turns: 1 } },
    { name: 'upright JPEG', file: 'quad-landscape.jpg' },
    { name: 'PDF page', file: 'quad-3pages.pdf#1' },
    { name: 'PDF page with /Rotate 90', file: 'quad-rotate90.pdf#0' },
    {
      name: 'PDF /Rotate 90 + turn + angle',
      file: 'quad-rotate90.pdf#0',
      p: { turns: 1, angle: 15 },
    },
    { name: 'PDF crop box off the origin', file: 'quad-cropbox.pdf#0', s: { margin: 30 } },
    { name: 'owner-locked PDF', file: 'quad-owner-locked.pdf#2', p: { turns: 2 } },
    { name: 'quarter turn', file: 'quad-landscape.jpg', p: { turns: 1 } },
    { name: 'half turn + straighten', file: 'quad-landscape.jpg', p: { turns: 2, angle: 12 } },
    { name: 'EXIF 6, no user turn', file: 'quad-exif6.jpg' },
    { name: 'EXIF 6 + three turns + angle', file: 'quad-exif6.jpg', p: { turns: 3, angle: -20 } },
    { name: 'EXIF 3', file: 'quad-exif3.jpg' },
    {
      name: 'PNG, scaled down, margin',
      file: 'quad-landscape.png',
      s: { margin: 50 },
      p: { scale: 0.6 },
    },
    {
      name: 'portrait page, cover',
      file: 'quad-landscape.jpg',
      s: { orientation: 'portrait' },
      p: { fit: 'cover', scale: 0.7 },
    },
  ]

  it.each(cases)('$name', async ({ file, s, p }) => {
    const docSettings = settings({ size: 'letter', ...s })
    const { bytes, assets, pages } = await build(docSettings, [{ file, ...(p ? { page: p } : {}) }])
    const pageModel = pages[0]
    const meta = assets[file]
    if (!pageModel || !meta) throw new Error('setup')
    const layout = layoutPage(docSettings, meta, pageModel)
    const pixel = rasterise(bytes)
    const { cx, cy, width, height, rotation } = layout.image
    const r = (rotation * Math.PI) / 180
    for (const [quadrant, { at, rgb }] of Object.entries(QUADRANTS)) {
      const dx = (at[0] - 0.5) * width
      const dy = (at[1] - 0.5) * height
      // Clockwise rotation in y-down screen space — what CSS rotate() does.
      const x = cx + dx * Math.cos(r) - dy * Math.sin(r)
      const y = cy + dx * Math.sin(r) + dy * Math.cos(r)
      const inside =
        x > layout.content.x + 2 &&
        x < layout.content.x + layout.content.width - 2 &&
        y > layout.content.y + 2 &&
        y < layout.content.y + layout.content.height - 2
      const got = pixel(x, y)
      if (inside)
        expect(
          close(got, rgb),
          `${quadrant} at ${x.toFixed(0)},${y.toFixed(0)} was ${got.join(',')}`,
        ).toBe(true)
    }
    // Margins stay blank: the image is clipped to the printable area.
    if (layout.content.x > 4)
      expect(close(pixel(2, layout.page.height / 2), [255, 255, 255])).toBe(true)
  })
})
