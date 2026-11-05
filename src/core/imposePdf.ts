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
const CUT_HALO = 1.6
const CUT_LINE = 0.5

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
      // A tick in from each edge, on the strip's side of the cut so nothing
      // of it is left on the part that shows: white under black, so it
      // shows on any picture.
      const x = cut.axis === 'x'
      const run = x ? height : sheet.size.width
      for (const from of [0, run - CUT_LENGTH]) {
        for (const [thick, grey] of [
          [CUT_HALO, 1],
          [CUT_LINE, 0],
        ] as const) {
          // Sheet coordinates run down; PDF ones up.
          out.drawRectangle({
            ...(x
              ? {
                  x: cut.at - thick,
                  y: height - from - CUT_LENGTH,
                  width: thick,
                  height: CUT_LENGTH,
                }
              : { x: from, y: height - cut.at, width: CUT_LENGTH, height: thick }),
            color: grayscale(grey),
          })
        }
      }
    }
    const { label } = sheet
    const f = label ? await font() : null
    const w = label && f ? f.widthOfTextAtSize(label.text, LABEL_SIZE) : 0
    // Only where it fits inside its strip, so none of it is left in view.
    if (label && f && (label.across ? w + 4 : LABEL_SIZE + 4) <= label.strip) {
      const { text, x, y } = label
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
