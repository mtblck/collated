// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { estimateBytes, QUALITY_PRESETS } from './compression'
import type { Asset, Quality } from './model'
import { buildPdf } from './pdf'
import {
  MIN_SHRINK_BYTES,
  listPdfImages,
  unfilterPng,
  type ShrinkJob,
  type PdfImageInfo,
} from './pdfImages'

const NOW = new Date('2026-11-05T12:00:00Z')
const FILE = 'scan-heavy.pdf'

const STAND_IN = `
import io, json, sys
from PIL import Image
job = json.loads(sys.argv[1])
data = sys.stdin.buffer.read()
if job['kind'] == 'jpeg':
    im = Image.open(io.BytesIO(data)).convert('RGB')
else:
    im = Image.frombytes('L' if job['channels'] == 1 else 'RGB', (job['sw'], job['sh']), data).convert('RGB')
im = im.resize((job['width'], job['height']), Image.BOX)
out = io.BytesIO()
im.save(out, 'JPEG', quality=round(job['quality'] * 100))
sys.stdout.buffer.write(out.getvalue())
`

/** What lib/filterCanvas.ts's shrinkToJpeg does, via Pillow. */
const shrinkStandIn = (jobs: ShrinkJob[]) => (job: ShrinkJob) => {
  jobs.push(job)
  const { source } = job
  const args = {
    kind: source.kind,
    width: job.width,
    height: job.height,
    quality: job.quality,
    ...(source.kind === 'pixels'
      ? { channels: source.channels, sw: source.width, sh: source.height }
      : {}),
  }
  return Promise.resolve(
    new Uint8Array(
      execFileSync('python3', ['-c', STAND_IN, JSON.stringify(args)], {
        input: Buffer.from(source.data),
      }),
    ),
  )
}

const pdfPage = (index: number, images?: PdfImageInfo[]): Asset =>
  asset(`p${String(index)}`, {
    bytesId: FILE,
    pdfPage: index,
    format: 'pdf',
    width: 612,
    height: 792,
    byteLength: fixture(FILE).byteLength,
    ...(images ? { images } : {}),
  })

const build = async (quality: Quality, maxBytes: number | null = null) => {
  const assets = Object.fromEntries([0, 1, 2].map((i) => [`p${String(i)}`, pdfPage(i)]))
  const jobs: ShrinkJob[] = []
  const bytes = await buildPdf(
    {
      // Pages as they are: 612 × 792 pt.
      settings: settings({ size: 'image', quality, maxBytes }),
      pages: [0, 1, 2].map((i) => page(`page${String(i)}`, `p${String(i)}`)),
      assets,
    },
    {
      getBytes: () => fixture(FILE),
      shrinkImage: shrinkStandIn(jobs),
      now: NOW,
    },
  )
  return { bytes, jobs }
}

const withFile = <T>(bytes: Uint8Array, run: (path: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'collated-shrink-'))
  try {
    const path = join(dir, 'out.pdf')
    writeFileSync(path, bytes)
    return run(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** pdfimages -list rows: page, width, height, encoding. */
const imagesIn = (bytes: Uint8Array) =>
  withFile(bytes, (path) =>
    execFileSync('pdfimages', ['-list', path])
      .toString()
      .split('\n')
      .slice(2)
      .filter((line) => line.trim())
      .map((line) => {
        const cols = line.trim().split(/\s+/)
        return {
          page: Number(cols[0]),
          width: Number(cols[3]),
          height: Number(cols[4]),
          enc: cols[8],
        }
      }),
  )

const textIn = (bytes: Uint8Array) =>
  execFileSync('pdftotext', ['-', '-'], { input: Buffer.from(bytes) }).toString()

/** Mean absolute difference (0–255) between two PDFs' pages rendered small. */
const renderDifference = (a: Uint8Array, b: Uint8Array, pageNumber: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'collated-shrink-render-'))
  try {
    const out: string[] = []
    for (const [i, bytes] of [a, b].entries()) {
      const pdf = join(dir, `${String(i)}.pdf`)
      writeFileSync(pdf, bytes)
      const n = String(pageNumber)
      execFileSync('pdftoppm', [
        '-r',
        '24',
        '-f',
        n,
        '-l',
        n,
        '-singlefile',
        '-png',
        pdf,
        join(dir, String(i)),
      ])
      out.push(join(dir, `${String(i)}.png`))
    }
    const script = `
import sys
from PIL import Image, ImageChops, ImageStat
a, b = (Image.open(p).convert('RGB') for p in sys.argv[1:])
print(sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3)
`
    return Number(execFileSync('python3', ['-c', script, ...out]).toString())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('listPdfImages', () => {
  it('lists the pictures each page draws that can be shrunk', async () => {
    const pages = await listPdfImages(fixture(FILE))
    expect(pages).toHaveLength(3)
    expect(pages[0]).toEqual([expect.objectContaining({ width: 2550, height: 3300 })])
    expect(pages[1]).toEqual([expect.objectContaining({ width: 600, height: 800 })])
    // Text only: nothing to shrink.
    expect(pages[2]).toEqual([])
    for (const image of pages.flat()) expect(image.bytes).toBeGreaterThan(MIN_SHRINK_BYTES)
  })

  it('leaves out pictures a re-encode would change', async () => {
    const variants: [string, (dict: PDFDict, doc: PDFDocument) => void][] = [
      [
        'a colour-key mask',
        (d, doc) => {
          d.set(PDFName.of('Mask'), doc.context.obj([0, 10, 0, 10, 0, 10]))
        },
      ],
      [
        'a Decode array',
        (d, doc) => {
          d.set(PDFName.of('Decode'), doc.context.obj([1, 0, 1, 0, 1, 0]))
        },
      ],
      [
        'JPEG decode parameters',
        (d, doc) => {
          d.set(PDFName.of('DecodeParms'), doc.context.obj({ ColorTransform: 0 }))
        },
      ],
      [
        'CMYK',
        (d) => {
          d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'))
        },
      ],
      [
        'a pre-multiplied soft mask',
        (d, doc) => {
          d.set(
            PDFName.of('SMask'),
            doc.context.register(
              doc.context.stream(new Uint8Array(4), {
                Type: 'XObject',
                Subtype: 'Image',
                Width: 2,
                Height: 2,
                ColorSpace: 'DeviceGray',
                BitsPerComponent: 8,
                Matte: [0, 0, 0],
              }),
            ),
          )
        },
      ],
    ]
    for (const [what, change] of variants) {
      const doc = await PDFDocument.load(fixture(FILE))
      const xobjects = doc.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'), PDFDict)
      const [entry] = xobjects?.values() ?? []
      const image = entry ? doc.context.lookup(entry) : undefined
      if (!(image instanceof PDFRawStream)) throw new Error('no scan')
      change(image.dict, doc)
      const pages = await listPdfImages(await doc.save())
      expect(pages[0], what).toEqual([])
    }
  })

  it('lists nothing in vector pages', async () => {
    const pages = await listPdfImages(fixture('quad-3pages.pdf'))
    expect(pages.flat()).toEqual([])
  })
})

describe('shrinking pictures inside PDF pages (#115)', () => {
  it('caps a scanned page at the preset and keeps every page’s text', async () => {
    const input = fixture(FILE)
    const { bytes, jobs } = await build('small')
    // 150 dpi on a Letter page: 1275 × 1650 from 2550 × 3300.
    expect(jobs.map((j) => [j.source.kind, j.width, j.height])).toEqual([
      ['jpeg', 1275, 1650],
      // Already under 150 dpi: kept at its size, recompressed.
      ['pixels', 600, 800],
    ])
    expect(bytes.byteLength).toBeLessThan(input.byteLength * 0.4)
    const images = imagesIn(bytes)
    expect(images).toEqual([
      { page: 1, width: 1275, height: 1650, enc: 'jpeg' },
      { page: 2, width: 600, height: 800, enc: 'jpeg' },
    ])
    const text = textIn(bytes)
    // The scan's invisible OCR layer, real text over a picture, and a text page.
    expect(text).toContain('Invoice searchable layer')
    expect(text).toContain('Kept as text')
    expect(text).toContain('Plain text page')
  })

  it('looks the same once shrunk (predictors undone, colours kept)', async () => {
    const { bytes } = await build('high')
    const original = (await build('original')).bytes
    expect(renderDifference(original, bytes, 1)).toBeLessThan(3)
    expect(renderDifference(original, bytes, 2)).toBeLessThan(3)
  })

  it('leaves the pictures alone at Original', async () => {
    const { bytes, jobs } = await build('original')
    expect(jobs).toEqual([])
    expect(imagesIn(bytes)).toEqual([
      { page: 1, width: 2550, height: 3300, enc: 'jpeg' },
      { page: 2, width: 600, height: 800, enc: 'image' },
    ])
  })

  it('keeps a picture that wouldn’t get smaller', async () => {
    const assets = { p0: pdfPage(0) }
    const bytes = await buildPdf(
      { settings: settings({ size: 'image', quality: 'high' }), pages: [page('a', 'p0')], assets },
      {
        getBytes: () => fixture(FILE),
        // The same JPEG with bytes to spare: no smaller than what's there.
        shrinkImage: ({ source }) => {
          const out = new Uint8Array(source.data.length + 16)
          out.set(source.data)
          return Promise.resolve(out)
        },
        now: NOW,
      },
    )
    expect(imagesIn(bytes)).toEqual([{ page: 1, width: 2550, height: 3300, enc: 'jpeg' }])
  })

  it('keeps a picture that can’t be re-encoded', async () => {
    const assets = { p0: pdfPage(0) }
    const bytes = await buildPdf(
      { settings: settings({ size: 'image', quality: 'small' }), pages: [page('a', 'p0')], assets },
      {
        getBytes: () => fixture(FILE),
        shrinkImage: () => Promise.reject(new Error('no canvas')),
        now: NOW,
      },
    )
    expect(imagesIn(bytes)).toEqual([{ page: 1, width: 2550, height: 3300, enc: 'jpeg' }])
  })

  it('shrinks for the largest the page is drawn', async () => {
    const assets = { p0: pdfPage(0) }
    const shrinkFor = async (pages: ReturnType<typeof page>[]) => {
      const jobs: ShrinkJob[] = []
      await buildPdf(
        { settings: settings({ size: 'a5', quality: 'small' }), pages, assets },
        { getBytes: () => fixture(FILE), shrinkImage: shrinkStandIn(jobs), now: NOW },
      )
      return jobs.map((j) => [j.width, j.height])
    }
    const small = await shrinkFor([page('small', 'p0')])
    const large = await shrinkFor([page('large', 'p0', { scale: 2 })])
    expect(large[0]?.[1]).toBeGreaterThan(small[0]?.[1] ?? Infinity)
    // Shown twice, small and large: once, for the large one.
    expect(await shrinkFor([page('small', 'p0'), page('large', 'p0', { scale: 2 })])).toEqual(large)
  })
})

describe('unfilterPng', () => {
  it('undoes each row filter', () => {
    // 2 × 3 grey pixels, rows filtered None, Sub, Up.
    const data = new Uint8Array([0, 10, 20, 1, 5, 5, 2, 1, 1])
    expect([...unfilterPng(data, 2, 1, 3)]).toEqual([10, 20, 5, 10, 6, 11])
  })

  it('refuses short data and unknown filters', () => {
    expect(() => unfilterPng(new Uint8Array([0, 1]), 2, 1, 1)).toThrow()
    expect(() => unfilterPng(new Uint8Array([9, 1, 2]), 2, 1, 1)).toThrow()
  })
})

describe('estimateBytes with PDF pictures', () => {
  it('counts what shrinking a PDF’s pictures saves', async () => {
    const pages = await listPdfImages(fixture(FILE))
    const items = [0, 1, 2].map((i) => ({ asset: pdfPage(i, pages[i]), drawnWidthPt: 612 }))
    const file = fixture(FILE).byteLength
    const original = estimateBytes(items, null)
    const small = estimateBytes(items, QUALITY_PRESETS.small)
    expect(original).toBe(file + 2_000)
    expect(small).toBeLessThan(file * 0.5)
    // Close to what the export really makes.
    const real = (await build('small')).bytes.byteLength
    expect(small / real).toBeGreaterThan(0.5)
    expect(small / real).toBeLessThan(2)
  })

  it('counts the whole file when its pictures weren’t listed', () => {
    const items = [0, 1].map((i) => ({ asset: pdfPage(i), drawnWidthPt: 612 }))
    expect(estimateBytes(items, QUALITY_PRESETS.small)).toBe(fixture(FILE).byteLength + 2_000)
  })
})
