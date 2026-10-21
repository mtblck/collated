// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, PDFName, PDFString, type PDFRawStream } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { buildPdf } from './pdf'
import { namesIn } from './pdfSanitize'

const hasQpdf = (() => {
  try {
    execFileSync('qpdf', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A JPEG carrying a marker in its EXIF, so we can tell which image is which. */
const taggedJpeg = (tag: string) => {
  const base = fixture('quad-landscape.jpg')
  const body = new TextEncoder().encode(`Exif\0\0${tag}`)
  const app1 = new Uint8Array([
    0xff,
    0xe1,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
    ...body,
  ])
  return new Uint8Array([...base.subarray(0, 2), ...app1, ...base.subarray(2)])
}

/**
 * Two pages sharing one resource dictionary (as many scanners write), with a
 * comment, page metadata, image metadata and a form that draws an image named
 * only in the page's resources.
 */
const scannerStyle = async () => {
  const doc = await PDFDocument.create()
  const a = await doc.embedJpg(taggedJpeg('EXIF-OF-PAGE-ONE'))
  const b = await doc.embedJpg(taggedJpeg('EXIF-OF-PAGE-TWO'))
  const c = await doc.embedJpg(taggedJpeg('EXIF-OF-FORM-IMAGE'))
  // Write the image objects now, so their dictionaries can be edited.
  await Promise.all([a.embed(), b.embed(), c.embed()])
  const { context } = doc
  const xmp = (text: string) =>
    context.register(context.stream(text, { Type: 'Metadata', Subtype: 'XML' }))
  const imageA = context.lookup(a.ref) as PDFRawStream
  const imageB = context.lookup(b.ref) as PDFRawStream
  imageA.dict.set(PDFName.of('Metadata'), xmp('IMAGE-XMP-ONE'))
  imageB.dict.set(PDFName.of('Metadata'), xmp('IMAGE-XMP-TWO'))
  // A form with no resources of its own: it uses the page's /ImC.
  const form = context.register(
    context.stream('q 50 0 0 50 0 0 cm /ImC Do Q', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 50, 50],
    }),
  )
  const shared = context.register(
    context.obj({ XObject: { ImA: a.ref, ImB: b.ref, ImC: c.ref, Fm0: form } }),
  )
  const contents = [
    'q 300 0 0 200 100 400 cm /ImA Do Q q 1 0 0 1 20 20 cm /Fm0 Do Q',
    'q 300 0 0 200 100 400 cm /ImB Do Q',
  ]
  for (const content of contents) {
    const p = doc.addPage([612, 792])
    p.node.set(PDFName.of('Resources'), shared)
    p.node.set(PDFName.of('Contents'), context.register(context.stream(content)))
    p.node.set(PDFName.of('Metadata'), xmp('PAGE-XMP-SECRET'))
    p.node.set(
      PDFName.of('PieceInfo'),
      context.obj({ Editor: { Private: PDFString.of('PIECE-SECRET') } }),
    )
    const annot = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: [0, 0, 10, 10],
        Contents: PDFString.of('COMMENT-SECRET'),
      }),
    )
    p.node.set(PDFName.of('Annots'), context.obj([annot]))
  }
  return doc.save({ useObjectStreams: false })
}

/** The export, decompressed so its contents can be searched as text. */
const exported = async (source: Uint8Array, pageIndex: number) => {
  const meta = asset('src', { format: 'pdf', pdfPage: pageIndex, width: 612, height: 792 })
  const pdf = await buildPdf(
    { settings: settings(), pages: [page('p', 'src')], assets: { src: meta } },
    { getBytes: () => source },
  )
  const dir = mkdtempSync(join(tmpdir(), 'collated-sanitize-'))
  try {
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.pdf')
    writeFileSync(input, pdf)
    execFileSync('qpdf', ['--qdf', '--object-streams=disable', input, output])
    return { pdf, text: readFileSync(output).toString('latin1') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('namesIn', () => {
  it('finds every name, decoding #xx escapes', () => {
    const names = namesIn(new TextEncoder().encode('/F1 12 Tf /Im#201 Do /GS0 gs [/a/b]'))
    expect([...names]).toEqual(expect.arrayContaining(['F1', 'Im 1', 'GS0', 'a', 'b']))
  })
})

describe.skipIf(!hasQpdf)('PDF pages are copied with only what they draw', () => {
  it('leaves out the other pages’ images from a shared resource dictionary', async () => {
    const { text } = await exported(await scannerStyle(), 0)
    expect(text).not.toContain('EXIF-OF-PAGE-TWO')
    expect(text).not.toContain('IMAGE-XMP-TWO')
    // The page's own image is there, without its metadata.
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(2) // ImA, and ImC via the form
    const second = await exported(await scannerStyle(), 1)
    expect(second.text).not.toContain('/ImA')
    expect(second.text.match(/\/Subtype \/Image/g)).toHaveLength(1)
  })

  it('removes comments, page metadata, image XMP and EXIF', async () => {
    const { text } = await exported(await scannerStyle(), 0)
    for (const secret of [
      'COMMENT-SECRET',
      'PAGE-XMP-SECRET',
      'PIECE-SECRET',
      'IMAGE-XMP-ONE',
      'EXIF-OF-PAGE-ONE',
      'EXIF-OF-FORM-IMAGE',
    ]) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('still draws everything the page shows', async () => {
    const { pdf } = await exported(await scannerStyle(), 0)
    const listed = execFileSync('pdfimages', ['-list', '-'], { input: Buffer.from(pdf) })
      .toString()
      .split('\n')
      .slice(2)
      .filter(Boolean)
    // ImA on the page, ImC through the form: both drawn, both decodable.
    expect(listed).toHaveLength(2)
    const ppm = execFileSync('pdftoppm', ['-r', '10', '-gray', '-'], { input: Buffer.from(pdf) })
    // Not blank: some pixels are well below white.
    expect(ppm.subarray(-2000).some((v) => v < 150)).toBe(true)
  })

  it('keeps the existing fixtures rendering (crop boxes, /Rotate, owner locks)', async () => {
    for (const [name, index] of [
      ['quad-3pages.pdf', 1],
      ['quad-rotate90.pdf', 0],
      ['quad-cropbox.pdf', 0],
      ['quad-owner-locked.pdf', 2],
    ] as const) {
      const { pdf } = await exported(fixture(name), index)
      expect((await PDFDocument.load(pdf)).getPageCount(), name).toBe(1)
    }
  })
})
