import { rotatedBounds, type Layout } from './geometry'
import { endsUnspaced, isRightToLeft, startsUnspaced } from './scripts'

/**
 * A recognised word, in fractions (0–1) of the page's image *as displayed* —
 * cropped, then turned and straightened, i.e. the rotated image's bounding
 * box. OCR reads that view, so a sideways photo the user turned upright is
 * read upright, and words run horizontally on the page.
 */
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** Baseline height, as a fraction from the top. */
  baseline: number
  /**
   * On a right-to-left line (#139): the line's words come left to right and
   * all go in the embedded font, so readers take the line as one run.
   */
  rtl?: boolean
}

const LTR_LETTER = /[\p{sc=Latin}\p{sc=Greek}\p{sc=Cyrillic}]/u

/**
 * One line's words, in reading order as the recogniser gives them, ready for
 * the text layer (#139):
 *
 * - Neighbours in Chinese or Japanese, which put no spaces between words, are
 *   joined into one, so a phrase is copied and searched without spaces in it
 *   (the recogniser splits them where it sees gaps).
 * - A right-to-left line (more Arabic or Hebrew words than Latin, Greek or
 *   Cyrillic ones) is put in the order its words sit on the page, left to
 *   right, the way right-to-left PDFs write it. Text readers (pdf.js,
 *   pdftotext) take such a line as one run and reorder it to reading order,
 *   with the spaces between its words; written in reading order instead,
 *   pdf.js reads each word on its own and loses the spaces.
 */
export const arrangeLine = (line: readonly OcrWord[]): OcrWord[] => {
  const joined: OcrWord[] = []
  for (const word of line) {
    const last = joined.at(-1)
    if (last && endsUnspaced(last.text) && startsUnspaced(word.text)) {
      joined[joined.length - 1] = {
        text: last.text + word.text,
        x0: Math.min(last.x0, word.x0),
        y0: Math.min(last.y0, word.y0),
        x1: Math.max(last.x1, word.x1),
        y1: Math.max(last.y1, word.y1),
        baseline: last.baseline,
      }
    } else {
      joined.push(word)
    }
  }
  const rtl = joined.filter((w) => isRightToLeft(w.text)).length
  const ltr = joined.filter((w) => LTR_LETTER.test(w.text)).length
  if (!rtl || rtl <= ltr) return joined
  return joined.map((w) => ({ ...w, rtl: true })).sort((a, b) => a.x0 - b.x0)
}

export interface WordPlacement {
  /** Start of the baseline, in PDF points (origin bottom-left). */
  x: number
  y: number
  /** Font size and the width the word must span, in points. */
  size: number
  width: number
}

/**
 * Where a word's invisible text goes so selecting it highlights the printed
 * word: its position in the displayed image's bounding box, which is centred
 * where the layout puts the image, flipped into PDF space.
 */
export const placeWord = (layout: Layout, word: OcrWord): WordPlacement => {
  const { cx, cy, width, height, rotation } = layout.image
  const box = rotatedBounds(width, height, rotation)
  const sx = cx + (word.x0 - 0.5) * box.width
  const sy = cy + (word.baseline - 0.5) * box.height
  return {
    x: sx,
    y: layout.page.height - sy,
    // Recognisers box the visible ink, so the em is a bit taller than the box.
    size: Math.max(1, (word.y1 - word.y0) * box.height * 1.1),
    width: Math.max(0.1, (word.x1 - word.x0) * box.width),
  }
}
