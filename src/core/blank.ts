import { inkMask } from './filters'

export interface Blankness {
  /** Share of the page (inside the border) covered by ink that counts as content. */
  ink: number
  blank: boolean
}

/**
 * How much darker than its surroundings a pixel must be to count as ink here.
 * Stricter than the B&W filter's 15%: bleed-through from the far side of thin
 * paper sits 10–25% below the paper, while print — even a thin stroke
 * softened in a thumbnail — sits 40% and more below it.
 */
export const BLANK_CONTRAST = 0.3

/**
 * Under this share of content ink, a page looks blank: about one short word
 * on a thumbnail. A few specks of dust stay under it; a signature or a line
 * of text doesn't.
 */
export const BLANK_INK = 1e-4

/** Ignored on every side: scanner-lid shadow, the page's own edge in a photo. */
const BORDER = 0.04

/** Paper this dark on average isn't a blank sheet (a dark cover, a night photo). */
const MIN_PAPER_LUMA = 128
/** Nor is paper this colourful (a printed coloured cover), by mean max−min of RGB. */
const MAX_PAPER_CHROMA = 48

/**
 * Scores how blank a page is, from its pixels (a thumbnail is plenty): the
 * share of it in ink, ignoring a 4% border, after leaving out what isn't
 * content —
 *
 * - **specks:** marks of a few pixels (dust, JPEG noise);
 * - **punch holes:** solid round blobs, 1.5–7% of the page's short side
 *   across (a 6 mm hole is 3% of A4's width). Rings like an "o" aren't solid
 *   and full stops are far smaller, so text is kept.
 *
 * Faint bleed-through never counts as ink (see `BLANK_CONTRAST`). Dark or
 * colourful paper is never blank, whatever its ink. Errs towards "not
 * blank": flagged pages are offered for removal, so a miss costs a click
 * and a false flag could cost a page.
 */
export const blankness = (rgba: Uint8ClampedArray, width: number, height: number): Blankness => {
  const mask = inkMask(rgba, width, height, BLANK_CONTRAST)
  const border = Math.round(Math.min(width, height) * BORDER)
  const x0 = border
  const y0 = border
  const x1 = width - border
  const y1 = height - border
  const area = Math.max(1, (x1 - x0) * (y1 - y0))

  let luma = 0
  let chroma = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4
      const r = rgba[i] ?? 0
      const g = rgba[i + 1] ?? 0
      const b = rgba[i + 2] ?? 0
      luma += 0.299 * r + 0.587 * g + 0.114 * b
      chroma += Math.max(r, g, b) - Math.min(r, g, b)
    }
  }
  const plainPaper = luma / area >= MIN_PAPER_LUMA && chroma / area <= MAX_PAPER_CHROMA

  // Connected marks (8-neighbour), measured one at a time.
  const short = Math.min(width, height)
  const speck = Math.max(4, Math.round(area * 1e-5))
  const holeMin = short * 0.015
  const holeMax = short * 0.07
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  let content = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const start = y * width + x
      if (!mask[start] || seen[start]) continue
      seen[start] = 1
      stack.push(start)
      let size = 0
      let left = x
      let right = x
      let top = y
      let bottom = y
      while (stack.length > 0) {
        const p = stack.pop() ?? 0
        const px = p % width
        const py = (p - px) / width
        size += 1
        if (px < left) left = px
        if (px > right) right = px
        if (py < top) top = py
        if (py > bottom) bottom = py
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy
          if (ny < y0 || ny >= y1) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx
            if (nx < x0 || nx >= x1) continue
            const q = ny * width + nx
            if (mask[q] && !seen[q]) {
              seen[q] = 1
              stack.push(q)
            }
          }
        }
      }
      const w = right - left + 1
      const h = bottom - top + 1
      const solidRound =
        Math.max(w, h) >= holeMin &&
        Math.max(w, h) <= holeMax &&
        Math.max(w, h) / Math.min(w, h) <= 1.5 &&
        size / (w * h) >= 0.6
      if (size >= speck && !solidRound) content += size
    }
  }

  const ink = content / area
  return { ink, blank: plainPaper && ink < BLANK_INK }
}
