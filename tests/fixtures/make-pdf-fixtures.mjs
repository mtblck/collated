/**
 * Regenerates the PDF test fixtures: node tests/fixtures/make-pdf-fixtures.mjs
 * (needs qpdf for the encrypted variants).
 *
 * Every page carries the same four coloured quadrants as the image fixtures
 * (TL red, TR green, BL blue, BR yellow) over its *visible* box, so a render
 * shows exactly how a page was rotated, cropped and placed.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFString,
  StandardFonts,
  degrees,
  rgb,
} from '@cantoo/pdf-lib'

const here = import.meta.dirname
const C = {
  tl: rgb(220 / 255, 30 / 255, 30 / 255),
  tr: rgb(30 / 255, 170 / 255, 60 / 255),
  bl: rgb(30 / 255, 60 / 255, 220 / 255),
  br: rgb(240 / 255, 200 / 255, 20 / 255),
}

/** Quadrants over (x, y, w, h) in page space, as the page appears unrotated. */
const quad = (page, x, y, w, h) => {
  const hw = w / 2
  const hh = h / 2
  page.drawRectangle({ x, y: y + hh, width: hw, height: hh, color: C.tl })
  page.drawRectangle({ x: x + hw, y: y + hh, width: hw, height: hh, color: C.tr })
  page.drawRectangle({ x, y, width: hw, height: hh, color: C.bl })
  page.drawRectangle({ x: x + hw, y, width: hw, height: hh, color: C.br })
}

const save = async (doc, name) => {
  doc.setProducer('collated fixtures')
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'))
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'))
  writeFileSync(join(here, name), await doc.save({ useObjectStreams: false }))
}

// 1. Three plain landscape pages, 300 × 200 pt.
{
  const doc = await PDFDocument.create()
  for (let i = 0; i < 3; i++) quad(doc.addPage([300, 200]), 0, 0, 300, 200)
  await save(doc, 'quad-3pages.pdf')
}

// 2. Content drawn portrait (200 × 300) with /Rotate 90: it *shows* landscape,
//    with the quadrants in the usual corners only after rotation, which is
//    the case viewers ignore when embedding naively.
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 300])
  // Draw so that a 90° clockwise turn puts TL red top-left: the unrotated
  // page holds the image turned 90° counter-clockwise.
  const w = 200
  const h = 300
  page.drawRectangle({ x: 0, y: 0, width: w / 2, height: h / 2, color: C.tl })
  page.drawRectangle({ x: 0, y: h / 2, width: w / 2, height: h / 2, color: C.tr })
  page.drawRectangle({ x: w / 2, y: 0, width: w / 2, height: h / 2, color: C.bl })
  page.drawRectangle({ x: w / 2, y: h / 2, width: w / 2, height: h / 2, color: C.br })
  page.setRotation(degrees(90))
  await save(doc, 'quad-rotate90.pdf')
}

// 3. A media box not at the origin, and a crop box inside it: the quadrants
//    fill the crop box and everything outside it is black, which must not show.
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 300])
  page.setMediaBox(-50, 20, 400, 300)
  page.drawRectangle({ x: -50, y: 20, width: 400, height: 300, color: rgb(0, 0, 0) })
  page.setCropBox(0, 60, 300, 200)
  quad(page, 0, 60, 300, 200)
  await save(doc, 'quad-cropbox.pdf')
}

// 4. Encrypted variants of (1): owner password only (opens without asking,
//    common for bank statements) and a user password (needs one to open).
const plain = join(here, 'quad-3pages.pdf')
execFileSync('qpdf', [
  '--encrypt',
  '',
  'owner-secret',
  '256',
  '--',
  plain,
  join(here, 'quad-owner-locked.pdf'),
])
execFileSync('qpdf', [
  '--encrypt',
  'user-secret',
  'owner-secret',
  '256',
  '--',
  plain,
  join(here, 'quad-password.pdf'),
])
console.log('PDF fixtures written')

// A page with a layer that's off by default, drawing a black box and text
// over the top-left quadrant: the preview doesn't show them, and nor may the
// export (it goes as a drawing, without them).
{
  const doc = await PDFDocument.create()
  const page = doc.addPage([300, 200])
  quad(page, 0, 0, 300, 200)
  const { context } = doc
  const hidden = context.register(context.obj({ Type: 'OCG', Name: PDFString.of('Private') }))
  doc.catalog.set(PDFName.of('OCProperties'), context.obj({ OCGs: [hidden], D: { OFF: [hidden] } }))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.node.Resources().set(PDFName.of('Properties'), context.obj({ L: hidden }))
  page.pushOperators(...[PDFOperator.of('BDC', [PDFName.of('OC'), PDFName.of('L')])])
  page.drawRectangle({ x: 10, y: 110, width: 130, height: 80, color: rgb(0, 0, 0) })
  page.drawText('HIDDEN-LAYER-TEXT', { x: 12, y: 150, size: 10, font, color: rgb(1, 1, 1) })
  page.pushOperators(PDFOperator.of('EMC'))
  // Visible text on a white band, for OCR of the drawn page (#52).
  page.drawRectangle({ x: 150, y: 20, width: 140, height: 40, color: rgb(1, 1, 1) })
  page.drawText('Visible words', { x: 158, y: 33, size: 16, font, color: rgb(0, 0, 0) })
  await save(doc, 'quad-layers.pdf')
}
