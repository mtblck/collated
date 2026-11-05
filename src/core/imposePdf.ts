import {
  PDFArray,
  PDFName,
  PDFRef,
  grayscale,
  type PDFDocument,
  type PDFFont,
} from '@cantoo/pdf-lib'
import { printSheets, type Imposition } from './impose'
import { toPoints } from './units'

/** How far a cut mark runs in from the sheet's edge. */
const CUT_LENGTH = toPoints(14, 'mm')
const LABEL_SIZE = 7

/**
 * Replaces the document's pages with the sheets of a booklet or poster
 * (#119). Each built page becomes a form XObject drawn where `printSheets`
 * places it, so it stays vector, its text layer stays searchable, and a
 * poster's tiles share one copy of it. Bookmarks point at pages that are no
 * longer there, so the caller writes none.
 */
export const imposePdf = async (
  doc: PDFDocument,
  imposition: Imposition,
  font: () => Promise<PDFFont>,
) => {
  const built = doc.getPages()
  const sizes = built.map((p) => p.getSize())
  const embedded = await Promise.all(built.map((p) => doc.embedPage(p)))
  // pdf-lib copies a page's content when the XObject is written, normally on
  // save: write them now, before the pages go.
  for (const page of embedded) await page.embed()
  // Their content now lives in the XObjects; drop the pages and their old
  // content streams, which nothing references any more.
  const leftovers: PDFRef[] = []
  for (const p of built) {
    leftovers.push(p.ref)
    const contents = p.node.get(PDFName.of('Contents'))
    if (contents instanceof PDFRef) leftovers.push(contents)
    else if (contents instanceof PDFArray) {
      for (const item of contents.asArray()) if (item instanceof PDFRef) leftovers.push(item)
    }
  }
  for (let i = built.length - 1; i >= 0; i--) doc.removePage(i)
  for (const ref of leftovers) doc.context.delete(ref)

  for (const sheet of printSheets(sizes, imposition)) {
    const out = doc.addPage([sheet.size.width, sheet.size.height])
    const { height } = sheet.size
    for (const placed of sheet.pages) {
      const page = embedded[placed.page]
      const size = sizes[placed.page]
      if (!page || !size) continue
      out.drawPage(page, {
        x: placed.x,
        y: height - placed.y - size.height * placed.scale,
        xScale: placed.scale,
        yScale: placed.scale,
      })
    }
    for (const cut of sheet.cuts) {
      // A tick in from each edge: white under black, so it shows on any picture.
      const ends =
        cut.axis === 'x'
          ? [
              [cut.at, 0, cut.at, CUT_LENGTH],
              [cut.at, height - CUT_LENGTH, cut.at, height],
            ]
          : [
              [0, cut.at, CUT_LENGTH, cut.at],
              [sheet.size.width - CUT_LENGTH, cut.at, sheet.size.width, cut.at],
            ]
      for (const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] of ends) {
        for (const [thickness, grey] of [
          [1.6, 1],
          [0.5, 0],
        ] as const) {
          out.drawLine({
            start: { x: x0, y: height - y0 },
            end: { x: x1, y: height - y1 },
            thickness,
            color: grayscale(grey),
          })
        }
      }
    }
    if (sheet.label) {
      const f = await font()
      const { text, x, y } = sheet.label
      const w = f.widthOfTextAtSize(text, LABEL_SIZE)
      out.drawRectangle({
        x: x - w / 2 - 2,
        y: height - y - LABEL_SIZE / 2 - 2,
        width: w + 4,
        height: LABEL_SIZE + 4,
        color: grayscale(1),
      })
      out.drawText(text, {
        x: x - w / 2,
        y: height - y - LABEL_SIZE * 0.35,
        size: LABEL_SIZE,
        font: f,
        color: grayscale(0.3),
      })
    }
  }
}
