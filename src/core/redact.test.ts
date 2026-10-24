// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import type { Redaction } from './model'
import { buildPdf, imageJob, type ImageJob } from './pdf'
import { NeedsDrawing } from './pdfSanitize'
import { FULL_IMAGE, type Quad } from './perspective'
import { cleanRedactions, redactionShapes, toDisplayed, wordsClear } from './redact'
import type { OcrWord } from './textLayer'

const hasTool = (tool: string) => {
  try {
    execFileSync(tool, ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const hasPoppler = hasTool('pdftotext') && hasTool('pdftoppm')

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

describe('cleanRedactions', () => {
  it('orders, clamps and drops slivers and junk', () => {
    expect(
      cleanRedactions([
        { x0: 0.6, y0: 0.5, x1: 0.2, y1: 0.1 },
        { x0: -0.2, y0: 0.9, x1: 0.3, y1: 1.4 },
        { x0: 0.5, y0: 0.5, x1: 0.501, y1: 0.9 },
        { x0: Number.NaN, y0: 0, x1: 1, y1: 1 },
      ]),
    ).toEqual([
      { x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.5 },
      { x0: 0, y0: 0.9, x1: 0.3, y1: 1 },
    ])
  })
})

describe('redactionShapes', () => {
  it('is the box itself without a crop', () => {
    const [shape] = redactionShapes([{ x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 }], null)
    expect(shape).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.3, y: 0.2 },
      { x: 0.3, y: 0.4 },
      { x: 0.1, y: 0.4 },
    ])
  })

  it('follows the crop: a box on the cropped area fills the flattened page', () => {
    const corners: Quad = [
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.9 },
    ]
    const [shape] = redactionShapes([{ x0: 0.2, y0: 0.1, x1: 0.8, y1: 0.9 }], corners)
    expect(shape).toBeDefined()
    shape?.forEach((p, i) => {
      close(p, FULL_IMAGE[i] ?? p)
    })
    // The left half of the crop is the left half of the page.
    const [half] = redactionShapes([{ x0: 0.2, y0: 0.1, x1: 0.5, y1: 0.9 }], corners)
    close(half?.[1] ?? { x: 0, y: 0 }, { x: 0.5, y: 0 })
  })
})

describe('words under a box', () => {
  it('maps into the turned view', () => {
    // A quarter turn clockwise: the top-left corner of a 200 × 100 image
    // ends at the top right of the turned 100 × 200 view.
    close(toDisplayed({ x: 0, y: 0 }, 200, 100, 90), { x: 1, y: 0 })
    close(toDisplayed({ x: 1, y: 1 }, 200, 100, 90), { x: 0, y: 1 })
  })

  const words: OcrWord[] = [
    { text: 'Account', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15, baseline: 0.15 },
    { text: '12345678', x0: 0.35, y0: 0.1, x1: 0.6, y1: 0.15, baseline: 0.15 },
    { text: '1234-partly', x0: 0.55, y0: 0.3, x1: 0.75, y1: 0.35, baseline: 0.35 },
  ]

  it('drops every word that touches one, and only those', () => {
    const shapes = redactionShapes(
      [
        { x0: 0.34, y0: 0.08, x1: 0.62, y1: 0.17 },
        { x0: 0.7, y0: 0.32, x1: 0.9, y1: 0.4 },
      ],
      null,
    )
    expect(
      wordsClear(words, shapes, { width: 100, height: 100, rotation: 0 }).map((w) => w.text),
    ).toEqual(['Account'])
  })

  it('finds them on a turned page', () => {
    // The number's box in the upright image, turned a quarter: it reads
    // across the top of the turned view, where the words are.
    const box = { x0: 0.1, y0: 0.4, x1: 0.15, y1: 0.65 }
    const shapes = redactionShapes([box], null)
    expect(
      wordsClear(words, shapes, { width: 100, height: 100, rotation: 90 }).map((w) => w.text),
    ).toEqual(['Account', '1234-partly'])
  })
})

describe('imageJob', () => {
  it('re-encodes an untouched image that has something blacked out', () => {
    const plain = { ...page('p', 'a') }
    const box: Redaction = { x0: 0.1, y0: 0.1, x1: 0.2, y1: 0.2 }
    const meta = asset('a')
    expect(imageJob(meta, plain, 100, null)).toBeNull()
    const job = imageJob(meta, { ...plain, redactions: [box] }, 100, null)
    expect(job).toMatchObject({ redactions: [box], format: 'jpeg', filter: 'original' })
    // A PNG stays lossless.
    expect(
      imageJob(asset('a', { format: 'png' }), { ...plain, redactions: [box] }, 100, null)?.format,
    ).toBe('png')
  })
})

/*
 * Stands in for lib/filterCanvas.ts via Pillow: paints the boxes on the
 * upright source in whole pixels, then crops and resizes as the job says.
 */
const STAND_IN = `
import io, json, math, sys
from PIL import Image, ImageDraw, ImageOps
job = json.loads(sys.argv[1])
im = ImageOps.exif_transpose(Image.open(io.BytesIO(sys.stdin.buffer.read()))).convert('RGB')
w, h = im.size
draw = ImageDraw.Draw(im)
for r in job.get('redactions') or []:
    draw.rectangle((math.floor(r['x0'] * w), math.floor(r['y0'] * h), math.ceil(r['x1'] * w) - 1, math.ceil(r['y1'] * h) - 1), fill=(0, 0, 0))
part = job.get('part')
if part:
    im = im.crop((round(part['x0'] * w), round(part['y0'] * h), round(part['x1'] * w), round(part['y1'] * h)))
im = im.resize((job['width'], job['height']))
out = io.BytesIO()
im.save(out, 'PNG' if job['format'] == 'png' else 'JPEG', quality=90)
sys.stdout.buffer.write(out.getvalue())
`
const processImage = (bytes: Uint8Array, job: ImageJob) =>
  Promise.resolve(
    new Uint8Array(
      execFileSync('python3', ['-c', STAND_IN, JSON.stringify(job)], { input: Buffer.from(bytes) }),
    ),
  )

const textOf = (pdf: Uint8Array) =>
  execFileSync('pdftotext', ['-layout', '-', '-'], { input: Buffer.from(pdf) }).toString()

/** The first page as greyscale pixels, at `dpi`. */
const greyOf = (pdf: Uint8Array, dpi: number) => {
  const pgm = execFileSync('pdftoppm', ['-r', String(dpi), '-gray', '-f', '1', '-l', '1', '-'], {
    input: Buffer.from(pdf),
  })
  // Binary PGM: "P5\n<w> <h>\n255\n" then one byte per pixel.
  const header = /^P5\s+(\d+)\s+(\d+)\s+255\s/.exec(pgm.subarray(0, 40).toString('latin1'))
  if (!header) throw new Error('Not a PGM.')
  const width = Number(header[1])
  const height = Number(header[2])
  const data = pgm.subarray(header[0].length)
  /** Mean grey of a rectangle given in fractions of the page. */
  const mean = (box: Redaction) => {
    let sum = 0
    let n = 0
    for (let y = Math.ceil(box.y0 * height); y < Math.floor(box.y1 * height); y++) {
      for (let x = Math.ceil(box.x0 * width); x < Math.floor(box.x1 * width); x++) {
        sum += data[y * width + x] ?? 0
        n++
      }
    }
    return sum / n
  }
  return { mean }
}

describe.skipIf(!hasPoppler)('the exported file', () => {
  // A letter-size PDF page with an account number to hide and a line to keep.
  const SECRET = { x0: 72 / 612, y0: (792 - 712) / 792, x1: 300 / 612, y1: (792 - 692) / 792 }
  const makeSource = async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    p.drawText('ACCOUNT 12345678', { x: 80, y: 698, size: 14, font })
    p.drawText('KEEP THIS LINE', { x: 80, y: 400, size: 14, font })
    return doc.save()
  }
  const pdfAsset = asset('src', { format: 'pdf', pdfPage: 0, width: 612, height: 792 })
  const input = (rendered?: Record<string, string>, text?: Record<string, OcrWord[]>) => ({
    settings: settings({ size: 'image', margin: 0 }),
    pages: [page('p', 'src', { redactions: [SECRET] })],
    assets: { src: pdfAsset },
    ...(rendered ? { rendered } : {}),
    ...(text ? { text } : {}),
  })

  it('never copies a PDF page with a box as vectors', async () => {
    const source = await makeSource()
    expect(textOf(source)).toContain('ACCOUNT 12345678')
    const build = buildPdf(input(), { getBytes: () => source, processImage })
    await expect(build).rejects.toBeInstanceOf(NeedsDrawing)
    await expect(build).rejects.toMatchObject({ assetIds: ['src'] })
  })

  it('exports a PDF page as a drawing with the box burned in and no text under it', async () => {
    const source = await makeSource()
    // The drawing the page would get: pdf.js in the app, Poppler here.
    const drawing = new Uint8Array(
      execFileSync('pdftoppm', ['-r', '100', '-jpeg', '-singlefile', '-'], {
        input: Buffer.from(source),
      }),
    )
    // Words a read of the drawing would give, in fractions of the page.
    const word = (text: string, x0: number, top: number, x1: number): OcrWord => ({
      text,
      x0: x0 / 612,
      y0: (792 - top - 14) / 792,
      x1: x1 / 612,
      y1: (792 - top) / 792,
      baseline: (792 - top) / 792,
    })
    const words = [
      word('ACCOUNT', 80, 698, 160),
      word('12345678', 165, 698, 240),
      word('KEEP', 80, 400, 120),
    ]
    const pdf = await buildPdf(input({ src: 'drawn' }, { p: words }), {
      getBytes: (id) => (id === 'drawn' ? drawing : source),
      processImage,
    })
    const text = textOf(pdf)
    expect(text).not.toContain('ACCOUNT')
    expect(text).not.toContain('12345678')
    expect(text).toContain('KEEP')
    const grey = greyOf(pdf, 72)
    // Solid black where the box is (a pixel in from its edges)…
    const inset = { x: 2 / 612, y: 2 / 792 }
    expect(
      grey.mean({
        x0: SECRET.x0 + inset.x,
        y0: SECRET.y0 + inset.y,
        x1: SECRET.x1 - inset.x,
        y1: SECRET.y1 - inset.y,
      }),
    ).toBeLessThan(8)
    // …and the page's own white elsewhere.
    expect(grey.mean({ x0: 0.6, y0: 0.05, x1: 0.95, y1: 0.2 })).toBeGreaterThan(245)
  })

  it('burns a box into an image page, crop or no crop', async () => {
    const bytes = fixture('quad-landscape.png')
    const meta = asset('img', { format: 'png', width: 240, height: 160 })
    const box = { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }
    const calls: ImageJob[] = []
    const pdf = await buildPdf(
      {
        settings: settings({ size: 'image', margin: 0 }),
        pages: [page('p', 'img', { redactions: [box] })],
        assets: { img: meta },
      },
      {
        getBytes: () => bytes,
        processImage: (b, job) => {
          calls.push(job)
          return processImage(b, job)
        },
      },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.redactions).toEqual([box])
    expect(greyOf(pdf, 72).mean({ x0: 0.27, y0: 0.27, x1: 0.73, y1: 0.73 })).toBeLessThan(8)
  })
})
