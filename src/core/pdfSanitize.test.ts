// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  type PDFObject,
  type PDFRawStream,
} from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { buildPdf } from './pdf'
import { namesIn } from './pdfContent'

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

  it('ignores names inside strings and inline image data, but not inline images’ colour spaces', () => {
    const names = namesIn(
      new TextEncoder().encode('(see p2/ImB) Tj BI /W 1 /H 1 /CS /CS0 ID /Fake EI'),
    )
    expect(names).not.toContain('ImB')
    expect(names).not.toContain('Fake')
    expect(names).toContain('CS0')
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
    stdio: ['pipe', 'pipe', 'ignore'],
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

/** An exported PDF uncompressed, as text, to search for what must not be in it. */
const qpdfText = (pdf: Uint8Array) => {
  const dir = mkdtempSync(join(tmpdir(), 'collated-sanitize-'))
  try {
    writeFileSync(join(dir, 'in.pdf'), pdf)
    execFileSync('qpdf', [
      '--qdf',
      '--object-streams=disable',
      join(dir, 'in.pdf'),
      join(dir, 'out.pdf'),
    ])
    return readFileSync(join(dir, 'out.pdf')).toString('latin1')
  } finally {
    rmSync(dir, { recursive: true, force: true })
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

  it('skips damaged annotations instead of failing the export', async () => {
    const variants: ((d: PDFDocument) => PDFObject)[] = [
      (d) => d.context.obj([PDFNumber.of(5)]),
      (d) => d.context.obj({ A: 1 }),
      (d) => d.context.obj([d.context.obj({ Subtype: PDFString.of('Stamp'), Rect: [0, 0, 1, 1] })]),
      (d) => d.context.obj([d.context.obj({ Subtype: 'Stamp', F: 'Hidden', Rect: [0, 0, 1, 1] })]),
      (d) =>
        d.context.obj([
          d.context.obj({
            Subtype: 'Widget',
            AS: PDFString.of('On'),
            Rect: [0, 0, 9, 9],
            AP: { N: { On: 1 } },
          }),
        ]),
      (d) => d.context.obj([d.context.obj({ Subtype: 'Stamp', AP: [1], Rect: [0, 0, 1, 1] })]),
      (d) => d.context.obj([d.context.obj({ Subtype: 'Stamp', AP: { N: 1 }, Rect: { a: 1 } })]),
      (d) =>
        d.context.obj([d.context.obj({ Subtype: 'Stamp', AP: { N: 1 }, Rect: [0, 0, 1e300, 1] })]),
    ]
    for (const [i, annots] of variants.entries()) {
      const doc = await PDFDocument.create()
      doc.addPage([612, 792]).node.set(PDFName.of('Annots'), annots(doc))
      await expect(exported(await doc.save(), 0), `variant ${String(i)}`).resolves.toBeTruthy()
    }
  })

  it('gives field appearances without resources the form’s fonts', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const { context } = doc
    const helv = context.register(
      context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }),
    )
    doc.catalog.set(
      PDFName.of('AcroForm'),
      context.obj({ Fields: [], DR: { Font: { Helv: helv } } }),
    )
    const ap = context.register(
      context.stream('/Tx BMC BT /Helv 12 Tf 5 5 Td (DRTEXT) Tj ET EMC', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 200, 30],
      }),
    )
    const widget = context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Widget',
        FT: 'Tx',
        Rect: [72, 600, 272, 630],
        AP: { N: ap },
      }),
    )
    p.node.set(PDFName.of('Annots'), context.obj([widget]))
    const { pdf, text } = await exported(await doc.save(), 0)
    expect(text).toContain('/BaseFont /Helvetica')
    expect(textOf(pdf)).toContain('DRTEXT')
  })

  it('draws annotations over content that leaves states and clips open', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const { context } = doc
    p.node.set(
      PDFName.of('Contents'),
      context.register(context.stream('q q /P BMC 500 500 50 50 re W n 0 g 500 500 50 50 re f')),
    )
    const box = context.register(
      context.stream('0 g 0 0 100 100 re f', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 100, 100],
      }),
    )
    const stamp = context.register(
      context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [72, 72, 172, 172], AP: { N: box } }),
    )
    p.node.set(PDFName.of('Annots'), context.obj([stamp]))
    const { pdf } = await exported(await doc.save(), 0)
    expect(greys(pdf).at(40, 264 - 40)).toBeLessThan(60)
  })

  it('unwraps JPEG images inside other filters and strips them; copies shared fonts once', async () => {
    const doc = await PDFDocument.create()
    const { context } = doc
    const wrapped = context.register(
      context.flateStream(taggedJpeg('WRAPPED-EXIF'), {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 240,
        Height: 160,
        ColorSpace: 'DeviceRGB',
        BitsPerComponent: 8,
      }),
    )
    // flateStream sets /Filter /FlateDecode: make it a chain ending in DCT.
    const image = context.lookup(wrapped) as PDFRawStream
    image.dict.set(
      PDFName.of('Filter'),
      context.obj([PDFName.of('FlateDecode'), PDFName.of('DCTDecode')]),
    )
    // A big shared font program, which must not be decoded once per page.
    const big = new Uint8Array(4_000_000).map((_, i) => (i * 2654435761) >>> 24)
    const font = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'TrueType',
        BaseFont: 'Big',
        FontDescriptor: {
          Type: 'FontDescriptor',
          FontName: 'Big',
          Flags: 32,
          FontFile2: context.register(context.flateStream(big)),
        },
      }),
    )
    const shared = context.register(context.obj({ Font: { F1: font }, XObject: { Im: wrapped } }))
    for (let i = 0; i < 10; i++) {
      const p = doc.addPage([612, 792])
      p.node.set(PDFName.of('Resources'), shared)
      p.node.set(
        PDFName.of('Contents'),
        context.register(context.stream('q 240 0 0 160 72 72 cm /Im Do Q BT /F1 12 Tf (x) Tj ET')),
      )
    }
    const source = await doc.save()
    const pages = Array.from({ length: 10 }, (_, i) => page(`p${String(i)}`, `a${String(i)}`))
    const assets = Object.fromEntries(
      pages.map((_, i) => [
        `a${String(i)}`,
        asset(`a${String(i)}`, {
          bytesId: 'src',
          format: 'pdf',
          pdfPage: i,
          width: 612,
          height: 792,
        }),
      ]),
    )
    const started = performance.now()
    const pdf = await buildPdf(
      { settings: settings({ size: 'image', margin: 0 }), pages, assets },
      { getBytes: () => source },
    )
    expect(performance.now() - started).toBeLessThan(5000)
    const text = qpdfText(pdf)
    expect(text).not.toContain('WRAPPED-EXIF')
    expect(text.match(/\/FontName \/Big/g)).toHaveLength(1)
    expect(greys(pdf).at(30, 264 - 30)).toBeLessThan(250) // the image still draws
  })

  it('keeps what forms without resources draw from their parent’s, nested or shared', async () => {
    const doc = await PDFDocument.create()
    const { context } = doc
    const square = (grey: number) =>
      context.register(
        context.stream(`${String(grey)} g 0 0 100 100 re f`, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 100, 100],
        }),
      )
    const form = (
      content: string,
      extra: Record<string, PDFObject | Record<string, PDFObject>> = {},
    ) =>
      context.register(
        context.stream(content, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 612, 792],
          ...extra,
        }),
      )
    // Nested: the inner form draws /Sq from the outer form's resources.
    const inner = form('q 1 0 0 1 72 72 cm /Sq Do Q')
    const outer = form('/In Do', {
      Resources: context.obj({ XObject: { In: inner, Sq: square(0) } }),
    })
    // A soft mask whose group has no resources: it draws /White from the form's.
    const maskGroup = form('/White Do', {
      Group: context.obj({ S: 'Transparency', CS: 'DeviceGray' }),
    })
    const masked = form('/GS gs 0 g 300 72 100 100 re f', {
      Resources: context.obj({
        ExtGState: { GS: { SMask: { S: 'Luminosity', G: maskGroup } } },
        XObject: { White: square(1) },
      }),
    })
    // Shared: one form without resources on two pages with different /Sq.
    const shared = form('q 1 0 0 1 72 72 cm /Sq Do Q')
    const pageWith = (resources: Record<string, Record<string, PDFObject>>, content: string) => {
      const p = doc.addPage([612, 792])
      p.node.set(PDFName.of('Resources'), context.obj(resources))
      p.node.set(PDFName.of('Contents'), context.register(context.stream(content)))
    }
    pageWith({ XObject: { Out: outer, M: masked } }, '/Out Do /M Do')
    pageWith({ XObject: { S: shared, Sq: square(0) } }, '/S Do')
    pageWith({ XObject: { S: shared, Sq: square(0.5) } }, '/S Do')
    const source = await doc.save()
    const all = [0, 1, 2]
    const pdf = await buildPdf(
      {
        settings: settings({ size: 'image', margin: 0 }),
        pages: all.map((i) => page(`p${String(i)}`, `a${String(i)}`)),
        assets: Object.fromEntries(
          all.map((i) => [
            `a${String(i)}`,
            asset(`a${String(i)}`, {
              bytesId: 'src',
              format: 'pdf',
              pdfPage: i,
              width: 612,
              height: 792,
            }),
          ]),
        ),
      },
      { getBytes: () => source },
    )
    // The mask's white square (named only in the masked form's resources) is kept.
    expect(qpdfText(pdf)).toContain('1 g 0 0 100 100 re f')
    // Every page renders as its source does.
    for (const i of all) {
      const render = (bytes: Uint8Array) =>
        execFileSync(
          'pdftoppm',
          ['-r', '24', '-gray', '-f', String(i + 1), '-l', String(i + 1), '-'],
          {
            input: Buffer.from(bytes),
            stdio: ['pipe', 'pipe', 'ignore'],
          },
        )
      expect(Buffer.compare(render(pdf), render(source)), `page ${String(i + 1)}`).toBe(0)
    }
  })

  it('gives a shared appearance without resources each page’s own', async () => {
    const doc = await PDFDocument.create()
    const { context } = doc
    const square = (grey: number) =>
      context.register(
        context.stream(`${String(grey)} g 0 0 1 1 re f`, {
          Type: 'XObject',
          Subtype: 'Form',
          BBox: [0, 0, 1, 1],
        }),
      )
    const ap = context.register(
      context.stream('q 100 0 0 100 0 0 cm /Im Do Q', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 100, 100],
      }),
    )
    for (const grey of [0.5, 0]) {
      const p = doc.addPage([612, 792])
      p.node.set(PDFName.of('Resources'), context.obj({ XObject: { Im: square(grey) } }))
      const stamp = context.register(
        context.obj({ Type: 'Annot', Subtype: 'Stamp', Rect: [72, 72, 172, 172], AP: { N: ap } }),
      )
      p.node.set(PDFName.of('Annots'), context.obj([stamp]))
    }
    const source = await doc.save()
    // Page 1 first, then page 2: page 2 keeps its black.
    for (const index of [0, 1]) await exported(source, index)
    const { pdf } = await exported(source, 1)
    expect(greys(pdf).at(40, 264 - 40)).toBeLessThan(30)
  })

  it('strips metadata boxes from JPEG 2000 images', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const { context } = doc
    const box = (type: string, body: Uint8Array) => {
      const out = new Uint8Array(8 + body.length)
      new DataView(out.buffer).setUint32(0, out.length)
      out.set(new TextEncoder().encode(type), 4)
      out.set(body, 8)
      return out
    }
    const jp2 = concatBytes(
      box('jP  ', new Uint8Array([0x0d, 0x0a, 0x87, 0x0a])),
      box('ftyp', new TextEncoder().encode('jp2 \0\0\0\0jp2 ')),
      box('xml ', new TextEncoder().encode('<x:xmpmeta>JPX-GPS-SECRET</x:xmpmeta>')),
      box('asoc', box('xml ', new TextEncoder().encode('ASOC-SECRET'))),
      box(
        'jp2c',
        concatBytes(
          new Uint8Array([0xff, 0x4f, 0xff, 0x64, 0x00, 0x14, 0x00, 0x01]),
          new TextEncoder().encode('JPX-COMMENT-SECR'),
          new Uint8Array([0xff, 0x90, 0x00, 0x0a, 0, 0, 0, 0, 0, 0, 0, 1, 0xff, 0xd9]),
        ),
      ),
      new Uint8Array([0x0a]), // a stray line end after the last box
    )
    const image = context.register(
      context.stream(jp2, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: 1,
        Height: 1,
        ColorSpace: 'DeviceGray',
        BitsPerComponent: 8,
        Filter: 'JPXDecode',
      }),
    )
    p.node.set(PDFName.of('Resources'), context.obj({ XObject: { Im: image } }))
    p.node.set(
      PDFName.of('Contents'),
      context.register(context.stream('q 10 0 0 10 0 0 cm /Im Do Q')),
    )
    const { text } = await exported(await doc.save(), 0)
    for (const secret of ['JPX-GPS-SECRET', 'ASOC-SECRET', 'JPX-COMMENT-SECR']) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('/JPXDecode')
  })

  it('exports a page that hides a layer as the drawing it is given, and nothing of the source', async () => {
    const doc = await PDFDocument.create()
    const p = doc.addPage([612, 792])
    const font = await doc.embedFont('Helvetica')
    p.drawText('VECTOR-SECRET', { x: 72, y: 700, size: 12, font })
    const source = await doc.save()
    const pdf = await buildPdf(
      {
        settings: settings({ size: 'image', margin: 0 }),
        pages: [page('p', 'src')],
        assets: { src: asset('src', { format: 'pdf', pdfPage: 0, width: 612, height: 792 }) },
        rendered: { src: 'drawn' },
      },
      { getBytes: (id) => (id === 'drawn' ? taggedJpeg('DRAWN-EXIF') : source) },
    )
    const text = qpdfText(pdf)
    expect(text).not.toContain('VECTOR-SECRET')
    expect(text).not.toContain('DRAWN-EXIF')
    expect(text).toMatch(/\/Subtype \/Image/)
    expect(textOf(pdf)).not.toContain('VECTOR-SECRET')
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
