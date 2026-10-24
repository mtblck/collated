// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  type PDFPage,
} from '@cantoo/pdf-lib'
import { afterAll, describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { layoutPage, layoutSheet, type Layout } from './geometry'
import { DEFAULT_TRANSFORM, blankPage } from './model'
import type { Asset, Page, PageTransform, Settings, SheetKind, Slot } from './model'
import { passthrough } from './imageInfo'
import { pdfFilename } from './filename'
import { buildPdf, imageJob, pageTurns, placement, visibleBox, type ImageJob } from './pdf'

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
      // Stands in for the worker's canvas: decodes upright (EXIF applied),
      // keeps the job's part, resizes and encodes. Filters aren't applied, so
      // placement (not pixels) is what's under test.
      processImage: (bytes, job) => Promise.resolve(canvasStandIn(bytes, job)),
      now: NOW,
    },
  )
  return { bytes, assets, pages }
}

const STAND_IN = `
import io, json, sys
from PIL import Image, ImageOps
job = json.loads(sys.argv[1])
im = ImageOps.exif_transpose(Image.open(io.BytesIO(sys.stdin.buffer.read()))).convert('RGB')
part = job.get('part')
if part:
    w, h = im.size
    im = im.crop((round(part['x0'] * w), round(part['y0'] * h), round(part['x1'] * w), round(part['y1'] * h)))
im = im.resize((job['width'], job['height']))
out = io.BytesIO()
im.save(out, 'PNG' if job['format'] == 'png' else 'JPEG', quality=90)
sys.stdout.buffer.write(out.getvalue())
`

/** What lib/filterCanvas.ts does, minus filters and corners, via Pillow. */
const canvasStandIn = (bytes: Uint8Array, job: ImageJob) =>
  new Uint8Array(
    execFileSync('python3', ['-c', STAND_IN, JSON.stringify(job)], { input: Buffer.from(bytes) }),
  )

const hasTool = (tool: string) => {
  try {
    execFileSync(tool, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    try {
      execFileSync(tool, ['-v'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}
const hasQpdf = hasTool('qpdf')
const hasPdftotext = hasTool('pdftotext')

/** Page texts separated by form feeds, or null without poppler. */
const extractText = (bytes: Uint8Array): string | null =>
  hasPdftotext
    ? execFileSync('pdftotext', ['-layout', '-', '-'], { input: Buffer.from(bytes) }).toString()
    : null

const buildWithPassword = async (password: string) => {
  const { meta, bytes } = await fileAsset('quad-landscape.jpg')
  return {
    bytes: await buildPdf(
      { settings: settings(), pages: [page('p', meta.id)], assets: { [meta.id]: meta }, password },
      { getBytes: () => bytes },
    ),
  }
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

  it('says only what the user chose: no default title, no URL, no time of day', async () => {
    const { bytes } = await build(settings(), [{ file: 'quad-exif6.jpg' }])
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(pdf.getTitle()).toBeUndefined()
    expect(pdf.getProducer()).toBe('Collated')
    expect(pdf.getCreator()).toBe('Collated')
    expect(pdf.getCreationDate()?.toISOString()).toBe('2026-10-21T00:00:00.000Z')
    expect(pdf.getModificationDate()?.toISOString()).toBe('2026-10-21T00:00:00.000Z')
    expect(pdf.catalog.get(PDFName.of('Lang'))?.toString()).toBe('(en)')
    // The photo's EXIF (camera, time, GPS) isn't in the file.
    expect(Buffer.from(bytes).includes(Buffer.from('Exif\0'))).toBe(false)
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

  it('runs filtered images through processImage once per image and filter', async () => {
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
        processImage: (_bytes, job) => {
          calls.push(job.filter)
          return Promise.resolve(
            fixture(job.format === 'png' ? 'quad-landscape.png' : 'quad-landscape.jpg'),
          )
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
    ).rejects.toThrow(/re-encode/)
  })

  it('sizes "match image" pages from the image at its dpi, and PDF pages as they are', async () => {
    const { bytes } = await build(settings({ size: 'image', imageDpi: 96 }), [
      { file: 'quad-landscape.jpg' },
      { file: 'quad-landscape.jpg', page: { turns: 1 } },
      { file: 'quad-3pages.pdf#0' },
    ])
    const sizes = (await PDFDocument.load(bytes))
      .getPages()
      .map((p) => [p.getWidth(), p.getHeight()])
    // 240 x 160 px at 96 dpi is 2.5 x 1.67 in = 180 x 120 pt; turned, 120 x 180.
    expect(sizes).toEqual([
      [180, 120],
      [120, 180],
      [300, 200],
    ])
  })

  it('prints page numbers as real text, counting from the start number', async () => {
    const { bytes } = await build(
      settings({ pageNumbers: { show: true, position: 'bottom-right', start: 7 } }),
      [{ file: 'quad-landscape.jpg' }, { file: 'quad-3pages.pdf#1' }],
    )
    const text = extractText(bytes)
    if (text === null) return
    expect(text.split('\f').map((t) => t.trim())).toEqual(['7', '8', ''])
  })

  it('makes a blank page (#80) with nothing on it but its number', async () => {
    const { meta, bytes: jpeg } = await fileAsset('quad-landscape.jpg')
    const build = (numbers: boolean) =>
      buildPdf(
        {
          settings: settings({
            size: 'letter',
            pageNumbers: { show: numbers, position: 'bottom-center', start: 1 },
          }),
          pages: [
            page('p0', meta.id),
            blankPage('b1'),
            { ...blankPage('b2'), turns: 1 },
            { ...blankPage('b3'), section: 'Back' },
          ],
          assets: { [meta.id]: meta },
        },
        { getBytes: () => jpeg, now: NOW },
      )
    // Every operator the page draws, decoded from its content streams.
    const operators = (p: PDFPage) => {
      const contents = p.node.Contents()
      const streams = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : []
      return streams
        .map((ref) => p.doc.context.lookup(ref))
        .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
        .map((s) => new TextDecoder().decode(decodePDFRawStream(s).decode()))
        .join('\n')
    }
    const xObjects = (p: PDFPage) =>
      p.node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)?.keys().length ?? 0

    const numbered = await PDFDocument.load(await build(true))
    const pages = numbered.getPages()
    // Letter, portrait unless turned (orientation Auto).
    expect(pages.map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [792, 612],
      [612, 792],
      [792, 612],
      [612, 792],
    ])
    const [photo, ...blanks] = pages
    if (!photo) throw new Error('no pages')
    expect(xObjects(photo)).toBe(1)
    for (const [i, blank] of blanks.entries()) {
      expect(xObjects(blank)).toBe(0)
      const ops = operators(blank)
      // Only the page number: one text block, nothing drawn outside it.
      expect(ops).toContain(`<${Buffer.from(String(i + 2)).toString('hex')}> Tj`)
      expect(ops.replace(/BT[\s\S]*?ET/g, '').trim()).toBe('q\n\nQ')
    }
    const text = extractText(await build(true))
    if (text !== null)
      expect(text.split('\f').map((t) => t.trim())).toEqual(['1', '2', '3', '4', ''])

    // Without numbers a blank page draws nothing at all.
    const bare = await PDFDocument.load(await build(false))
    for (const blank of bare.getPages().slice(1)) {
      expect(xObjects(blank)).toBe(0)
      expect(operators(blank).trim()).toBe('')
    }
  })

  it('encrypts with the password so the file only opens with it', async () => {
    const plain = await build(settings(), [{ file: 'quad-landscape.jpg' }])
    const { bytes } = await buildWithPassword('correct horse')
    await expect(PDFDocument.load(bytes)).rejects.toThrow()
    const opened = await PDFDocument.load(bytes, { password: 'correct horse' })
    expect(opened.getPageCount()).toBe(1)
    expect(plain.bytes.length).toBeGreaterThan(0)
    if (hasQpdf) {
      const path = join(work, 'locked.pdf')
      writeFileSync(path, bytes)
      const info = execFileSync('qpdf', [
        '--password=correct horse',
        '--show-encryption',
        path,
      ]).toString()
      expect(info).toMatch(/AESv3|256/)
    }
  })

  it.skipIf(!hasQpdf)('opens with the password however its accents were typed', async () => {
    // Decomposed (e + combining acute, as macOS often types) vs composed.
    const { bytes } = await buildWithPassword('cafe\u0301 ﬁle')
    const path = join(work, 'accents.pdf')
    writeFileSync(path, bytes)
    const opens = (password: string) => {
      try {
        execFileSync('qpdf', [`--password=${password}`, '--check', path], { stdio: 'ignore' })
        return true
      } catch {
        return false
      }
    }
    expect(opens('caf\u00e9 file')).toBe(true) // NFKC: composed é, "ﬁ" ligature → "fi"
    expect(opens('cafe')).toBe(false)
  })

  it('refuses a password PDF readers would cut short', async () => {
    await expect(buildWithPassword('a'.repeat(128))).rejects.toThrow(/too long/)
    await expect(buildWithPassword('a'.repeat(127))).resolves.toBeDefined()
    // Bytes, not characters: 43 three-byte characters is 129 bytes.
    await expect(buildWithPassword('€'.repeat(43))).rejects.toThrow(/too long/)
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

/**
 * Checks a rendered page against one picture's layout: the fixture's four
 * coloured quadrants where the layout puts them, white where it puts none
 * inside the picture's printable area (its cell, on a combined page).
 */
const expectDrawn = (pixel: (x: number, y: number) => number[], layout: Layout) => {
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
  // A grid over the printable area, each point checked against the colour
  // the layout puts there: catches content shifted or scaled by a little.
  const quadrantColour = (u: number, v: number) =>
    u < 0.5
      ? v < 0.5
        ? QUADRANTS.tl.rgb
        : QUADRANTS.bl.rgb
      : v < 0.5
        ? QUADRANTS.tr.rgb
        : QUADRANTS.br.rgb
  const band = 0.04
  for (let gx = 1; gx < 16; gx++) {
    for (let gy = 1; gy < 16; gy++) {
      const x = layout.content.x + (layout.content.width * gx) / 16
      const y = layout.content.y + (layout.content.height * gy) / 16
      const dx = x - cx
      const dy = y - cy
      const u = (dx * Math.cos(r) + dy * Math.sin(r)) / width + 0.5
      const v = (-dx * Math.sin(r) + dy * Math.cos(r)) / height + 0.5
      // Skip points near an edge or a quadrant boundary, where resampling blurs.
      const near = (n: number) =>
        Math.abs(n) < band || Math.abs(n - 0.5) < band || Math.abs(n - 1) < band
      if (near(u) || near(v)) continue
      const want = u < 0 || u > 1 || v < 0 || v > 1 ? [255, 255, 255] : quadrantColour(u, v)
      const got = pixel(x, y)
      expect(
        close(got, want),
        `grid ${gx},${gy} (u ${u.toFixed(2)}, v ${v.toFixed(2)}) was ${got.join(',')}`,
      ).toBe(true)
    }
  }
  // Margins (and gaps between cells) stay blank: the image is clipped to
  // its printable area.
  const { x, y, height: h } = layout.content
  const off = Math.min(8, x / 2)
  if (x > 4) {
    const got = pixel(x - off, y + h / 2)
    expect(
      close(got, [255, 255, 255]),
      `left of ${String(x)},${String(y)} was ${got.join(',')}`,
    ).toBe(true)
  }
}

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
    // Hidden parts aren't stored: these keep only the visible part.
    { name: 'Fill, cropped to the page', file: 'quad-landscape.jpg', p: { fit: 'cover' } },
    {
      name: 'scaled past 100%, straightened',
      file: 'quad-landscape.jpg',
      s: { margin: 40 },
      p: { scale: 1.5, angle: 10 },
    },
    {
      name: 'EXIF 6, turned and scaled past 100%',
      file: 'quad-exif6.jpg',
      p: { turns: 1, scale: 1.4, angle: -7 },
    },
    { name: 'PNG filled onto a portrait page', file: 'quad-landscape.png', p: { fit: 'cover' } },
  ]

  it.each(cases)('$name', async ({ file, s, p }) => {
    const docSettings = settings({ size: 'letter', ...s })
    const { bytes, assets, pages } = await build(docSettings, [{ file, ...(p ? { page: p } : {}) }])
    const pageModel = pages[0]
    const meta = assets[file]
    if (!pageModel || !meta) throw new Error('setup')
    const layout = layoutPage(docSettings, meta, pageModel)
    const pixel = rasterise(bytes)
    expectDrawn(pixel, layout)
  })
})

describe.skipIf(!hasPdftoppm)('combined pages match the layout (#76)', () => {
  interface Picture {
    file: string
    look?: Partial<PageTransform>
  }
  const buildSheet = async (s: Settings, kind: SheetKind, pictures: Picture[]) => {
    const files = new Map(
      await Promise.all(pictures.map(async ({ file }) => [file, await fileAsset(file)] as const)),
    )
    const assets = Object.fromEntries([...files].map(([k, v]) => [k, v.meta]))
    const bytesById = new Map([...files.values()].map((v) => [v.meta.bytesId, v.bytes]))
    const slots: Slot[] = pictures.map(({ file, look }) => ({
      assetId: file,
      ...DEFAULT_TRANSFORM,
      ...look,
    }))
    const sheet: Page = {
      id: 'sheet',
      assetId: pictures[0]?.file ?? '',
      ...DEFAULT_TRANSFORM,
      sheet: { kind, slots },
    }
    const bytes = await buildPdf(
      { settings: s, pages: [sheet], assets },
      {
        getBytes: (id) => bytesById.get(id) ?? new Uint8Array(),
        processImage: (bytes, job) => Promise.resolve(canvasStandIn(bytes, job)),
        now: NOW,
      },
    )
    return { bytes, layout: layoutSheet(s, assets, sheet) }
  }

  const cases: { name: string; kind: SheetKind; s?: Partial<Settings>; pictures: Picture[] }[] = [
    {
      name: '2-up: a photo and an EXIF-rotated photo, turned',
      kind: 'two',
      pictures: [{ file: 'quad-landscape.jpg' }, { file: 'quad-exif6.jpg', look: { turns: 1 } }],
    },
    {
      name: '2-up, landscape, with a margin and a straightened PDF page',
      kind: 'two',
      s: { orientation: 'landscape', margin: 36 },
      pictures: [
        { file: 'quad-portrait.jpg' },
        { file: 'quad-rotate90.pdf#0', look: { angle: 8 } },
      ],
    },
    {
      name: '4-up: photo, PDF page, filled PNG, scaled EXIF photo',
      kind: 'four',
      pictures: [
        { file: 'quad-landscape.jpg' },
        { file: 'quad-3pages.pdf#1' },
        { file: 'quad-landscape.png', look: { fit: 'cover' } },
        { file: 'quad-exif6.jpg', look: { scale: 1.3, angle: -10 } },
      ],
    },
    {
      name: '4-up with three pictures, match-image page',
      kind: 'four',
      s: { size: 'image', margin: 20, imageDpi: 40 },
      pictures: [
        { file: 'quad-landscape.jpg' },
        { file: 'quad-portrait.jpg', look: { turns: 2 } },
        { file: 'quad-exif3.jpg' },
      ],
    },
    {
      name: 'ID card: both sides at card size, one filled',
      kind: 'id-card',
      pictures: [
        { file: 'quad-landscape.jpg', look: { fit: 'cover' } },
        { file: 'quad-exif6.jpg' },
      ],
    },
  ]

  it.each(cases)('$name', async ({ kind, s, pictures }) => {
    const docSettings = settings({ size: 'letter', ...s })
    const { bytes, layout } = await buildSheet(docSettings, kind, pictures)
    expect(layout.pictures).toHaveLength(pictures.length)
    const pixel = rasterise(bytes)
    for (const picture of layout.pictures) expectDrawn(pixel, picture)
    // Cells don't overlap: each picture is clipped to its own.
    for (const [i, a] of layout.pictures.entries()) {
      for (const b of layout.pictures.slice(i + 1)) {
        const apart =
          a.content.x + a.content.width <= b.content.x + 0.01 ||
          b.content.x + b.content.width <= a.content.x + 0.01 ||
          a.content.y + a.content.height <= b.content.y + 0.01 ||
          b.content.y + b.content.height <= a.content.y + 0.01
        expect(apart).toBe(true)
      }
    }
  })

  it('prints an ID card at 85.6 × 54 mm', async () => {
    const { bytes, layout } = await buildSheet(settings({ size: 'a4' }), 'id-card', [
      { file: 'quad-landscape.jpg', look: { fit: 'cover' } },
      { file: 'quad-landscape.png', look: { fit: 'cover' } },
    ])
    const mm = (pt: number) => (pt / 72) * 25.4
    for (const { content } of layout.pictures) {
      expect(mm(content.width)).toBeCloseTo(85.6, 1)
      expect(mm(content.height)).toBeCloseTo(54, 1)
    }
    // Filled to the card's edges, and nothing outside them.
    const pixel = rasterise(bytes)
    const [front] = layout.pictures
    if (!front) throw new Error('setup')
    const { x, y, width, height } = front.content
    expect(close(pixel(x + 3, y + 3), QUADRANTS.tl.rgb)).toBe(true)
    expect(close(pixel(x + width - 3, y + height - 3), QUADRANTS.br.rgb)).toBe(true)
    expect(close(pixel(x - 3, y + height / 2), [255, 255, 255])).toBe(true)
    expect(close(pixel(x + width / 2, y + height + 3), [255, 255, 255])).toBe(true)
  })
})

describe.skipIf(!hasPdftoppm)('a page that hides part of its image', () => {
  // gradient.png: red = how far across, green = how far down.
  const cases: { name: string; s?: Partial<Settings>; p: Partial<Page> }[] = [
    { name: 'Fill', p: { fit: 'cover' } },
    { name: 'scaled 150%, straightened, margin', s: { margin: 40 }, p: { scale: 1.5, angle: 10 } },
    { name: 'turned, scaled 180%', s: { orientation: 'portrait' }, p: { turns: 1, scale: 1.8 } },
  ]

  it.each(cases)('stores only what shows, in place ($name)', async ({ s, p }) => {
    const docSettings = settings({ size: 'letter', ...s })
    const { bytes, assets, pages } = await build(docSettings, [{ file: 'gradient.png', page: p }])
    const meta = assets['gradient.png']
    const pageModel = pages[0]
    if (!meta || !pageModel) throw new Error('setup')
    const layout = layoutPage(docSettings, meta, pageModel)

    // The stored image is the visible part, not the whole image.
    const listed = execFileSync('pdfimages', ['-list', '-'], { input: Buffer.from(bytes) })
      .toString()
      .split('\n')
      .slice(2)
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/).map(String))
    expect(listed).toHaveLength(1)
    const [, , , w = '0', h = '0'] = listed[0] ?? []
    expect(Number(w) * Number(h)).toBeLessThan(meta.width * meta.height * 0.9)

    // And it lands where the whole image would have: colour = position.
    const pixel = rasterise(bytes)
    const { cx, cy, width, height, rotation } = layout.image
    const r = (rotation * Math.PI) / 180
    let checked = 0
    for (let gx = 1; gx < 12; gx++) {
      for (let gy = 1; gy < 12; gy++) {
        const x = layout.content.x + (layout.content.width * gx) / 12
        const y = layout.content.y + (layout.content.height * gy) / 12
        const dx = x - cx
        const dy = y - cy
        const u = (dx * Math.cos(r) + dy * Math.sin(r)) / width + 0.5
        const v = (-dx * Math.sin(r) + dy * Math.cos(r)) / height + 0.5
        if (u < 0.02 || u > 0.98 || v < 0.02 || v > 0.98) continue
        const got = pixel(x, y)
        const want = [255 * u, 255 * v, 128]
        expect(
          got.every((c, i) => Math.abs(c - (want[i] ?? 0)) < 16),
          `at u ${u.toFixed(2)}, v ${v.toFixed(2)}: ${got.join(',')}`,
        ).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(40)
  })
})

describe('cropping a page’s hidden part', () => {
  it('crops on whole pixels, copies them 1:1, and keeps a PNG lossless', async () => {
    const jobs: ImageJob[] = []
    const { bytes, meta } = await fileAsset('gradient.png')
    const docSettings = settings({ size: 'letter' })
    await buildPdf(
      {
        settings: docSettings,
        pages: [page('p', meta.id, { scale: 1.37, angle: 3 })],
        assets: { [meta.id]: meta },
      },
      {
        getBytes: () => bytes,
        processImage: (b, job) => {
          jobs.push(job)
          return Promise.resolve(canvasStandIn(b, job))
        },
      },
    )
    const [job] = jobs
    if (!job?.part) throw new Error('expected a cropped job')
    const { x0, y0, x1, y1 } = job.part
    for (const [edge, size] of [
      [x0, meta.width],
      [x1, meta.width],
      [y0, meta.height],
      [y1, meta.height],
    ] as const) {
      expect(Number.isInteger(Math.round(edge * size * 1e6) / 1e6)).toBe(true)
    }
    // Output is exactly the cropped pixels: no resampling at 100%.
    expect(job.width).toBe(Math.round((x1 - x0) * meta.width))
    expect(job.height).toBe(Math.round((y1 - y0) * meta.height))
    expect(job.format).toBe('png')
  })

  it('re-encodes a cropped JPEG once, at 0.92', () => {
    const job = imageJob(
      asset('a', { width: 1000, height: 800 }),
      { filter: 'original' },
      500,
      null,
      {
        x0: 0.1,
        y0: 0,
        x1: 0.9,
        y1: 1,
      },
    )
    expect(job).toMatchObject({ format: 'jpeg', quality: 0.92, width: 800, height: 800 })
  })
})
