import type { QuarterTurns } from './model'

/**
 * Below this, Tesseract's orientation answer is a guess. A full page of text
 * scores 25–35; four short lines about 7; the same page shrunk until its
 * letters are ~12 px scores ~3 and is often wrong, which is why pages are
 * read at OSD_EDGE rather than from their thumbnails.
 */
export const MIN_CONFIDENCE = 5

/** The long edge, in pixels, a page is read at for its orientation. */
export const OSD_EDGE = 2000

/** What orientation detection said about a page (see lib/ocr.ts). */
export interface Osd {
  /** Clockwise degrees that would turn the text upright: 0, 90, 180 or 270. */
  degrees: number
  confidence: number
}

/**
 * The clockwise quarter turns that bring a page's text upright (0 when it
 * already is), or null when there wasn't enough text to be sure.
 */
export const uprightTurns = (osd: Osd | null): QuarterTurns | null => {
  if (!osd || !(osd.confidence >= MIN_CONFIDENCE)) return null
  const quarters = Math.round(osd.degrees / 90)
  if (Math.abs(osd.degrees - quarters * 90) > 1) return null
  return (((quarters % 4) + 4) % 4) as QuarterTurns
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "page 3", "pages 2 and 5", "pages 2, 5 and 7"; past a dozen, just the count. */
const pageList = (positions: number[]) => {
  if (positions.length === 1) return `page ${String(positions[0])}`
  if (positions.length > 12) return plural(positions.length, 'page')
  const head = positions.slice(0, -1).join(', ')
  return `pages ${head} and ${String(positions.at(-1))}`
}

/**
 * The status after Auto-rotate pages: which pages it turned (by position, so
 * they can be found), and how many it left alone and why.
 */
export const describeAutoRotate = ({
  turned,
  upright,
  unclear,
}: {
  /** 1-based positions of the pages it turned. */
  turned: number[]
  /** Pages already the right way up. */
  upright: number
  /** Pages with too little text to tell. */
  unclear: number
}): string => {
  const total = turned.length + upright + unclear
  const one = total === 1
  const parts = [
    turned.length > 0
      ? `Turned ${one ? 'the page' : pageList(turned)} the right way up.`
      : unclear === total
        ? ''
        : one
          ? 'The page is already the right way up.'
          : unclear === 0
            ? `All ${String(total)} pages are already the right way up.`
            : 'No pages needed turning.',
    unclear === 0
      ? ''
      : one
        ? 'There isn’t enough text on the page to tell which way up it goes, so it was left as it is.'
        : unclear === 1
          ? '1 page had too little text to tell and was left as it is.'
          : `${String(unclear)} pages had too little text to tell and were left as they are.`,
  ]
  return parts.filter(Boolean).join(' ')
}
