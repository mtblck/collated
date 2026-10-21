import { rotatedBounds, type Layout } from './geometry'

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
