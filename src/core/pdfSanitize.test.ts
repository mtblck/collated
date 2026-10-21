// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFArray, PDFDocument, PDFName, PDFString, type PDFRawStream } from '@cantoo/pdf-lib'
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
    {
      settings: settings({ size: 'image', margin: 0 }),
      pages: [page('p', 'src')],
      assets: { src: meta },
    },
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

/** Page 1 of a PDF as greyscale pixels (poppler draws annotations, as pdf.js does). */
const greys = (pdf: Uint8Array) => {
  const out = execFileSync('pdftoppm', ['-r', '24', '-gray', '-f', '1', '-l', '1', '-'], {
    input: Buffer.from(pdf),
  })
  const header = out.subarray(0, 20).toString('latin1').split(/\s+/)
  const width = Number(header[1])
  const offset = out.indexOf('255\n', 0, 'latin1') + 4
  return {
    width,
    at: (x: number, y: number) => out[offset + y * width + x] ?? 255,
    all: out.subarray(offset),
  }
}

const textOf = (pdf: Uint8Array) =>
  execFileSync('pdftotext', ['-', '-'], { input: Buffer.from(pdf) }).toString()

describe.skipIf(!hasQpdf)('what a PDF page shows comes with it', () => {
  it('draws filled form fields and stamps; leaves hidden ones and comment text out (#31)', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const form = doc.getForm()
    const field = form.createTextField('name')
    field.setText('FILLED-VALUE')
    field.addToPage(p, { x: 72, y: 600, width: 300, height: 40 })
    form.updateFieldAppearances()
    const { context } = doc
    const box = (rgb: string) =>
      context.register(
        context.stream(`${rgb} rg 0 0 100 100 re f`, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 100, 100],
        }),
      )
    const annot = (extra: Record<string, unknown>) =>
      context.register(context.obj({ Type: 'Annot', Rect: [72, 72, 172, 172], ...extra }))
    const stamp = annot({ Subtype: 'Stamp', AP: { N: box('0 0 0') } })
    const hidden = annot({
      Subtype: 'Stamp',
      F: 2,
      Rect: [400, 72, 500, 172],
      AP: { N: box('0 0 0') },
    })
    const note = annot({ Subtype: 'Popup', Contents: PDFString.of('PRIVATE-COMMENT') })
    p.node.lookup(PDFName.of('Annots'), PDFArray).push(stamp)
    p.node.lookup(PDFName.of('Annots'), PDFArray).push(hidden)
    p.node.lookup(PDFName.of('Annots'), PDFArray).push(note)
    const source = await doc.save()

    const { pdf, text } = await exported(source, 0)
    expect(textOf(pdf)).toContain('FILLED-VALUE')
    expect(text).not.toContain('PRIVATE-COMMENT')
    expect(text).not.toMatch(/\/Subtype \/Widget|\/AcroForm/)
    const out = greys(pdf)
    // 24 dpi: 1 px = 3 pt; y from the top.
    expect(out.at(40, 264 - 40)).toBeLessThan(60) // the stamp, drawn
    expect(out.at(150, 264 - 40)).toBeGreaterThan(200) // the hidden one, not
    // And overall it matches what a viewer shows for the source.
    const before = greys(source)
    let differ = 0
    for (let i = 0; i < out.all.length; i++) {
      if (Math.abs((out.all[i] ?? 0) - (before.all[i] ?? 0)) > 60) differ++
    }
    expect(differ / out.all.length).toBeLessThan(0.002)
  })

  it('keeps hidden layers hidden and shown layers shown (#28)', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const { context } = doc
    const layer = (name: string) =>
      context.register(context.obj({ Type: 'OCG', Name: PDFString.of(name) }))
    const shown = layer('Shown')
    const hiddenLayer = layer('Hidden')
    doc.catalog.set(
      PDFName.of('OCProperties'),
      context.obj({ OCGs: [shown, hiddenLayer], D: { OFF: [hiddenLayer] } }),
    )
    p.node.set(PDFName.of('Resources'), context.obj({ Properties: { L1: shown, L2: hiddenLayer } }))
    p.node.set(
      PDFName.of('Contents'),
      context.register(
        context.stream(
          '/OC /L1 BDC 0 g 72 72 100 100 re f EMC /OC /L2 BDC 0 g 400 72 100 100 re f EMC',
        ),
      ),
    )
    const source = await doc.save()
    const before = greys(source)
    expect(before.at(150, 264 - 40)).toBeGreaterThan(200) // hidden in the source
    const { pdf } = await exported(source, 0)
    const out = greys(pdf)
    expect(out.at(40, 264 - 40)).toBeLessThan(60)
    expect(out.at(150, 264 - 40)).toBeGreaterThan(200)
  })

  it('strips metadata from JPEGs written inline in a page or a form (#28)', async () => {
    const jpeg = taggedJpeg('INLINE-GPS-SECRET')
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const { context } = doc
    const inline = (at: string) =>
      concatBytes(
        new TextEncoder().encode(
          `q 100 0 0 75 ${at} cm BI /W 240 /H 160 /CS /RGB /BPC 8 /F /DCT ID `,
        ),
        jpeg,
        new TextEncoder().encode(' EI Q'),
      )
    const form = context.register(
      context.flateStream(inline('0 0'), {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 200, 200],
      }),
    )
    p.node.set(PDFName.of('Resources'), context.obj({ XObject: { Fm: form } }))
    p.node.set(
      PDFName.of('Contents'),
      context.register(
        context.flateStream(
          concatBytes(inline('72 600'), new TextEncoder().encode(' q 1 0 0 1 300 300 cm /Fm Do Q')),
        ),
      ),
    )
    const source = await doc.save()
    const { pdf, text } = await exported(source, 0)
    expect(text).not.toContain('INLINE-GPS-SECRET')
    // Both images still draw.
    const out = greys(pdf)
    expect(out.at(40, 264 - 210)).toBeLessThan(200)
    expect(out.at(110, 264 - 110)).toBeLessThan(200)
  })
})

const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
