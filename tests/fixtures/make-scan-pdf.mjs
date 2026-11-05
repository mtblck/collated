/**
 * Regenerates the heavy scanned-PDF fixture (#115): node tests/fixtures/make-scan-pdf.mjs
 *
 * scan-heavy.pdf, three US Letter pages:
 * 1. A 300 dpi colour scan (JPEG, 2550 × 3300) filling the page, with an
 *    invisible OCR layer ("Invoice searchable layer") over it, as scanner
 *    apps write them.
 * 2. Real text ("Kept as text") over a Flate RGB picture (600 × 800, PNG
 *    predictors, every row filter type) filling the lower part.
 * 3. Text only ("Plain text page").
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  PDFDocument,
  PDFName,
  StandardFonts,
  TextRenderingMode,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
} from '@cantoo/pdf-lib'

const here = import.meta.dirname
const doc = await PDFDocument.create()
const font = await doc.embedFont(StandardFonts.Helvetica)

{
  const page = doc.addPage([612, 792])
  const scan = await doc.embedJpg(readFileSync(join(here, 'scan-letter-300dpi.jpg')))
  page.drawImage(scan, { x: 0, y: 0, width: 612, height: 792 })
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.Invisible))
  page.drawText('Invoice searchable layer', { x: 72, y: 700, size: 18, font })
  page.pushOperators(popGraphicsState())
}

{
  const page = doc.addPage([612, 792])
  page.drawText('Kept as text', { x: 72, y: 720, size: 24, font, color: rgb(0, 0, 0) })
  const width = 600
  const height = 800
  const channels = 3
  // A smooth picture with a little deterministic grain, so it compresses
  // like a photo rather than like a flat fill.
  let seed = 115
  const grain = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed % 9) - 4
  }
  const rowBytes = width * channels
  const raw = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * rowBytes + x * channels
      raw[i] = Math.max(0, Math.min(255, Math.round((x / width) * 255) + grain()))
      raw[i + 1] = Math.max(0, Math.min(255, Math.round((y / height) * 255) + grain()))
      raw[i + 2] = Math.max(0, Math.min(255, 128 + grain()))
    }
  }
  // PNG row filters, cycling through all five.
  const filtered = new Uint8Array((rowBytes + 1) * height)
  for (let y = 0; y < height; y++) {
    const type = y % 5
    filtered[y * (rowBytes + 1)] = type
    for (let x = 0; x < rowBytes; x++) {
      const v = raw[y * rowBytes + x]
      const a = x >= channels ? raw[y * rowBytes + x - channels] : 0
      const b = y > 0 ? raw[(y - 1) * rowBytes + x] : 0
      const c = x >= channels && y > 0 ? raw[(y - 1) * rowBytes + x - channels] : 0
      let predicted = 0
      if (type === 1) predicted = a
      else if (type === 2) predicted = b
      else if (type === 3) predicted = (a + b) >> 1
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      filtered[y * (rowBytes + 1) + 1 + x] = (v - predicted) & 0xff
    }
  }
  const { context } = doc
  const image = context.register(
    context.stream(deflateSync(filtered), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: width,
      Height: height,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: channels, BitsPerComponent: 8, Columns: width },
    }),
  )
  const xobjects = context.obj({ Photo: image })
  page.node.Resources().set(PDFName.of('XObject'), xobjects)
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(432, 0, 0, 576, 90, 72),
    drawObject('Photo'),
    popGraphicsState(),
  )
}

{
  const page = doc.addPage([612, 792])
  page.drawText('Plain text page', { x: 72, y: 720, size: 24, font, color: rgb(0, 0, 0) })
}

doc.setProducer('collated fixtures')
doc.setCreationDate(new Date('2026-01-01T00:00:00Z'))
doc.setModificationDate(new Date('2026-01-01T00:00:00Z'))
writeFileSync(join(here, 'scan-heavy.pdf'), await doc.save({ useObjectStreams: false }))
console.log('scan-heavy.pdf written')
