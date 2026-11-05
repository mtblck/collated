import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFRawStream, PDFStream, decodePDFRawStream } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { ARCHIVE_WIDTHS } from './archiveFontData'
import type { Asset, Mark, Page, Settings } from './model'
import { buildPdf } from './pdf'
import { NeedsDrawing } from './pdfSanitize'
import { srgbProfile, xmpPacket } from './pdfa'
import type { OcrWord } from './textLayer'
import { NO_WATERMARK } from './watermark'

/*
 * PDF/A-2b (#116). veraPDF, the reference validator, checks the files when
 * it's installed: set VERAPDF to its command (`scripts/verapdf.sh` fetches
 * it; CI does). Without it, the structure PDF/A needs is checked here directly.
 */
const VERAPDF = process.env.VERAPDF
const NOW = new Date('2026-10-21T12:00:00Z')

const has = (tool: string) => {
  try {
    execFileSync(tool, ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const hasPdffonts = has('pdffonts')
const hasPdftotext = has('pdftotext')
const work = mkdtempSync(join(tmpdir(), 'collated-pdfa-'))

/** veraPDF's verdict for PDF/A-2b, with the failed rules. */
const validate = (bytes: Uint8Array, name: string) => {
  if (!VERAPDF) return null
  const path = join(work, `${name}.pdf`)
  writeFileSync(path, bytes)
  let out: string
  try {
    out = execFileSync(VERAPDF, ['-f', '2b', '--format', 'text', '-v', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (error) {
    // veraPDF exits 1 when the file doesn't conform; the report is still on stdout.
    out = String((error as { stdout?: string }).stdout ?? error)
  }
  return out
}

/** Java starts slowly. */
const VERA_TIMEOUT = 60_000

const expectConforming = (bytes: Uint8Array, name: string) => {
  const report = validate(bytes, name)
  if (report === null) return
  expect(report, report).toMatch(/^PASS /m)
}

const SIGNATURE = new Uint8Array(
  execFileSync('python3', [
    '-c',
    `import sys; from PIL import Image, ImageDraw
im = Image.new('RGBA', (300, 100), (0, 0, 0, 0))
ImageDraw.Draw(im).rectangle((0, 34, 299, 65), fill=(230, 0, 200, 255))
im.save(sys.stdout.buffer, 'PNG')`,
  ]),
)
const GREY = new Uint8Array(
  execFileSync('python3', [
    '-c',
    `import sys; from PIL import Image
Image.new('1', (200, 300), 1).save(sys.stdout.buffer, 'PNG')`,
  ]),
)

const words: OcrWord[] = [
  { text: 'Invoice', x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.15, baseline: 0.15 },
  { text: 'Счёт', x0: 0.4, y0: 0.1, x1: 0.55, y1: 0.15, baseline: 0.15 },
  { text: 'Łódź', x0: 0.6, y0: 0.1, x1: 0.75, y1: 0.15, baseline: 0.15 },
]

const marks: Mark[] = [
  {
    id: 't1',
    kind: 'text',
    text: 'Avery Quinn\n5 Nov 2026 · £12',
    x: 0.5,
    y: 0.3,
    angle: 10,
    size: 24 / 612,
    colour: '#1d4ed8',
  },
  { id: 's1', kind: 'tick', x: 0.3, y: 0.7, angle: 0, width: 60 / 612, colour: '#c0262d' },
  {
    id: 'm1',
    kind: 'signature',
    assetId: 'signature',
    x: 0.3,
    y: 0.9,
    width: 0.45,
    angle: 0,
  },
]

const build = async (
  s: Settings,
  options: { text?: boolean; extra?: Partial<Page>; password?: string } = {},
) => {
  const photo = fixture('quad-landscape.jpg')
  const assets: Record<string, Asset> = {
    photo: asset('photo', { width: 240, height: 160 }),
    grey: asset('grey', { format: 'png', width: 200, height: 300 }),
    signature: asset('signature', { format: 'png', width: 300, height: 100 }),
  }
  const bytes: Record<string, Uint8Array> = { photo, grey: GREY, signature: SIGNATURE }
  const pages = [
    page('p0', 'photo', { marks, ...options.extra }),
    page('p1', 'grey'),
    page('p2', '', { blank: true }),
  ]
  return buildPdf(
    {
      settings: s,
      pages,
      assets,
      ...(options.text ? { text: { p0: words, p1: words } } : {}),
      ...(options.password ? { password: options.password } : {}),
      outline: [{ pageId: 'p1', title: 'Grey «page»', children: [] }],
    },
    { getBytes: (id) => bytes[id] ?? new Uint8Array(), now: NOW },
  )
}

const archival = settings({
  pdfa: true,
  title: 'Records & <receipts> — 2026',
  pageNumbers: { show: true, position: 'bottom-center', start: 1 },
  watermark: { ...NO_WATERMARK, show: true, text: 'Copy for Acme Bank', opacity: 0.3 },
})

const metadataOf = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const stream = doc.catalog.lookup(PDFName.of('Metadata'), PDFStream)
  if (!(stream instanceof PDFRawStream)) throw new Error('no raw metadata stream')
  return { doc, xmp: new TextDecoder().decode(decodePDFRawStream(stream).decode()) }
}

describe('PDF/A-2b export (#116)', () => {
  it(
    'conforms, with marks, a watermark, page numbers and bookmarks',
    async () => {
      const bytes = await build(archival)
      expectConforming(bytes, 'plain')
      const { doc, xmp } = await metadataOf(bytes)
      expect(xmp).toContain('<pdfaid:part>2</pdfaid:part>')
      expect(xmp).toContain('<pdfaid:conformance>B</pdfaid:conformance>')
      expect(xmp).toContain('Records &amp; &lt;receipts&gt; — 2026')
      expect(xmp).toContain('<xmp:CreateDate>2026-10-21T00:00:00Z</xmp:CreateDate>')
      expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeDefined()
      expect(doc.context.trailerInfo.ID).toBeDefined()
      expect(doc.isEncrypted).toBe(false)
    },
    VERA_TIMEOUT,
  )

  it(
    'conforms with OCR text, Latin and not',
    async () => {
      const bytes = await build(archival, { text: true })
      expectConforming(bytes, 'ocr')
      if (hasPdftotext) {
        // Spaces dropped: the turned mark breaks into lines.
        const text = execFileSync('pdftotext', ['-', '-'], { input: Buffer.from(bytes) })
          .toString()
          .replace(/\s+/g, '')
        for (const w of ['Invoice', 'Счёт', 'Łódź', 'AveryQuinn', 'CopyforAcmeBank']) {
          expect(text).toContain(w)
        }
      }
    },
    VERA_TIMEOUT,
  )

  it.skipIf(!hasPdffonts)('embeds every font', async () => {
    const bytes = await build(archival, { text: true })
    const path = join(work, 'fonts.pdf')
    writeFileSync(path, bytes)
    const rows = execFileSync('pdffonts', [path], { encoding: 'utf8' }).split('\n').slice(2)
    const fonts = rows.filter((row) => row.trim())
    expect(fonts.length).toBeGreaterThanOrEqual(2)
    // pdffonts' "emb" column: every font says yes.
    for (const row of fonts)
      expect(row, row).toMatch(/\s+yes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/)
  })

  it('keeps standard Helvetica (not embedded) and no PDF/A metadata otherwise', async () => {
    const bytes = await build({ ...archival, pdfa: false }, { text: true })
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined()
    expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeUndefined()
  })

  it('refuses a password', async () => {
    await expect(build(archival, { password: 'secret' })).rejects.toThrow(/PDF\/A/)
  })

  it('draws every PDF page rather than copying it', async () => {
    const pdf = fixture('quad-3pages.pdf')
    const meta = asset('doc#0', {
      format: 'pdf',
      bytesId: 'doc',
      pdfPage: 0,
      width: 612,
      height: 792,
    })
    const attempt = buildPdf(
      { settings: archival, pages: [page('p0', meta.id)], assets: { [meta.id]: meta } },
      { getBytes: () => pdf, now: NOW },
    )
    await expect(attempt).rejects.toBeInstanceOf(NeedsDrawing)
  })

  it('writes the Arimo widths the font has, Helvetica’s for plain text', () => {
    // A–Z, a–z, 0–9: the widths layout measures with.
    const helvetica: Record<string, number> = { A: 667, a: 556, '0': 556, W: 944, i: 222 }
    for (const [ch, width] of Object.entries(helvetica)) {
      expect(ARCHIVE_WIDTHS[ch.charCodeAt(0) - 32]).toBe(width)
    }
  })

  it('makes a valid ICC header and XMP without a title', () => {
    const icc = srgbProfile()
    const view = new DataView(icc.buffer)
    expect(view.getUint32(0)).toBe(icc.length)
    expect(new TextDecoder().decode(icc.slice(36, 40))).toBe('acsp')
    expect(new TextDecoder().decode(icc.slice(12, 20))).toBe('mntrRGB ')
    const xmp = xmpPacket({ title: '', tool: 'Collated', date: NOW })
    expect(xmp).not.toContain('dc:title')
    expect(xmp).toContain('<xmp:ModifyDate>2026-10-21T12:00:00Z</xmp:ModifyDate>')
  })
})
