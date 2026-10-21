import type { PageNumbers } from './model'

/** Printed size of page numbers, in points. */
export const NUMBER_SIZE = 9
/** Mid grey: legible on white paper without competing with the content. */
export const NUMBER_GREY = 0.35

export interface NumberMark {
  text: string
  /** Anchor in page points (top-left origin): the text's centre or right edge. */
  x: number
  /** Baseline, in page points from the top. */
  baseline: number
  align: 'center' | 'right'
  size: number
}

/**
 * Where a page's number goes. In the middle of the margin band when there is
 * a margin of at least 24 pt, so it never touches the content; otherwise
 * 18 pt from the edge, printed over whatever is there.
 */
export const numberMark = (
  options: PageNumbers,
  index: number,
  page: { width: number; height: number },
  margin: number,
): NumberMark | null => {
  if (!options.show) return null
  const inset = margin >= 24 ? margin / 2 : 18
  const text = String(options.start + index)
  const top = options.position === 'top-right'
  // Baseline sits a third of the type size below the band's centre line.
  const baseline = top ? inset + NUMBER_SIZE / 3 : page.height - inset + NUMBER_SIZE / 3
  return options.position === 'bottom-center'
    ? { text, x: page.width / 2, baseline, align: 'center', size: NUMBER_SIZE }
    : { text, x: page.width - inset, baseline, align: 'right', size: NUMBER_SIZE }
}
