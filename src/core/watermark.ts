import type { PageNumbers, Watermark } from './model'
import { NUMBER_SIZE, bandInset } from './pageNumbers'

/** Off, and what it looks like once turned on. */
export const NO_WATERMARK: Watermark = {
  show: false,
  text: '',
  position: 'diagonal',
  size: 'medium',
  opacity: 0.3,
  colour: '#808080',
  flatten: false,
  pageIds: null,
}

export const WATERMARK_OPACITY_MIN = 0.1

/** The preview's and the flattened page's font; the PDF uses its standard Helvetica. */
export const WATERMARK_FONT = 'Helvetica, Arial, sans-serif'

/** Helvetica's cap height, in ems (from its AFM). */
const CAP_HEIGHT = 0.718

/** Type size across the page, as a share of the page's shorter side. */
const DIAGONAL_SHARE = { small: 0.06, medium: 0.09, large: 0.13 } as const
/** Type size along the foot, in points. */
const FOOTER_SIZE = { small: 7, medium: 9, large: 12 } as const
/** Longer text shrinks to fit this share of the diagonal. */
const DIAGONAL_FIT = 0.8

export interface WatermarkMark {
  text: string
  /** Middle of the text's baseline, in page points from the top-left. */
  x: number
  baseline: number
  size: number
  /** Clockwise, in degrees, on screen (y down): negative rises to the right. */
  angle: number
  colour: { r: number; g: number; b: number }
  opacity: number
}

/*
 * Helvetica advance widths (thousandths of an em) from its AFM, the metrics
 * the PDF's standard font uses. Kept here so the preview sizes the text
 * exactly as the export does without loading pdf-lib (worker only).
 */
const ASCII =
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'
    .split(' ')
    .map(Number)
const OTHER: Record<string, number> = {
  ' ': 278,
  '·': 278,
  '–': 556,
  '—': 1000,
  '‘': 222,
  '’': 222,
  '‚': 222,
  '“': 333,
  '”': 333,
  '„': 333,
  '•': 350,
  '…': 1000,
  '€': 556,
  '©': 737,
  '®': 737,
  '°': 400,
  '×': 584,
  '£': 556,
  '§': 556,
  ß: 611,
  Æ: 1000,
  æ: 889,
  Ø: 778,
  ø: 611,
  Œ: 1000,
  œ: 944,
  '¡': 333,
  '¦': 260,
  '¨': 333,
  ª: 370,
  '¬': 584,
  '\u00ad': 333,
  '¯': 333,
  '±': 584,
  '²': 333,
  '³': 333,
  '´': 333,
  '¶': 537,
  '¸': 333,
  '¹': 333,
  º: 365,
  '¼': 834,
  '½': 834,
  '¾': 834,
  '¿': 611,
  Ð: 722,
  Þ: 667,
  // Accented i's are on the dotless i, wider than the dotted one.
  ì: 278,
  í: 278,
  î: 278,
  ï: 278,
  '÷': 584,
  Ÿ: 500,
  ˆ: 333,
  '˜': 333,
  '‰': 1000,
  '‹': 333,
  '›': 333,
  '™': 1000,
}

const charWidth = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 32 && code < 127) return ASCII[code - 32] ?? 556
  const known = OTHER[ch]
  if (known !== undefined) return known
  // Accented letters are as wide as their base letter.
  const base = ch.normalize('NFD').codePointAt(0) ?? 0
  return base >= 32 && base < 127 ? (ASCII[base - 32] ?? 556) : 556
}

/** Width of `text` set in Helvetica at `size` points. */
export const textWidth = (text: string, size: number) => {
  let units = 0
  for (const ch of text) units += charWidth(ch)
  return (units * size) / 1000
}

/** The characters beyond Latin-1 that the standard fonts' encoding (WinAnsi) has. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

/**
 * Characters the PDF's standard font can't set, in order, once each. Text
 * with any of them can only be drawn into the pictures (see `flatten`).
 */
export const unsupportedCharacters = (text: string) => {
  const out: string[] = []
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0
    const ok =
      (code >= 32 && code < 127) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)
    if (!ok && !out.includes(ch)) out.push(ch)
  }
  return out
}

/** `#rrggbb` as 0–1 channels; anything else is mid grey. */
export const colourOf = (hex: string) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return { r: 0.5, g: 0.5, b: 0.5 }
  const channel = (h: string | undefined) => parseInt(h ?? '80', 16) / 255
  return { r: channel(m[1]), g: channel(m[2]), b: channel(m[3]) }
}

/** Whether a page carries the watermark (all pages, or only the chosen ones). */
export const watermarks = (options: Watermark, pageId: string) =>
  options.show &&
  options.text.trim() !== '' &&
  (options.pageIds === null || options.pageIds.includes(pageId))

/**
 * Where the watermark goes on a page, for the preview and the export alike.
 *
 * Across the page, it runs along the diagonal from bottom-left to top-right,
 * its capitals centred on the page's centre; text too long for the diagonal
 * shrinks to fit. Along the foot, it is centred in the bottom margin band
 * (as page numbers are), a line above the numbers when they are there too,
 * shrinking to fit between the bands' insets.
 */
export const watermarkMark = (
  options: Watermark,
  pageId: string,
  page: { width: number; height: number },
  margin: number,
  numbers: PageNumbers,
): WatermarkMark | null => {
  if (!watermarks(options, pageId)) return null
  const text = options.text.trim().normalize('NFC')
  const colour = colourOf(options.colour)
  const opacity = Math.min(1, Math.max(WATERMARK_OPACITY_MIN, options.opacity))
  const fit = (size: number, room: number) => {
    const width = textWidth(text, size)
    return width > room ? (size * room) / width : size
  }
  if (options.position === 'footer') {
    const inset = bandInset(margin)
    const size = fit(FOOTER_SIZE[options.size], page.width - 2 * inset)
    const numbersBelow = numbers.show && numbers.position !== 'top-right'
    const baseline = page.height - inset + size / 3 - (numbersBelow ? NUMBER_SIZE * 1.6 : 0)
    return { text, x: page.width / 2, baseline, size, angle: 0, colour, opacity }
  }
  const rad = -Math.atan2(page.height, page.width)
  const size = fit(
    Math.min(page.width, page.height) * DIAGONAL_SHARE[options.size],
    Math.hypot(page.width, page.height) * DIAGONAL_FIT,
  )
  // The baseline sits half a cap height below the centre, along the text's
  // own "down" (the y axis turned with it).
  const drop = (CAP_HEIGHT * size) / 2
  return {
    text,
    x: page.width / 2 - Math.sin(rad) * drop,
    baseline: page.height / 2 + Math.cos(rad) * drop,
    size,
    angle: (rad * 180) / Math.PI,
    colour,
    opacity,
  }
}
