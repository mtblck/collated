import type { PageSizeId, Settings } from './model'
import { baseSize } from './pageSizes'
import { toPoints } from './units'

/**
 * Printing the finished pages another way (#119): as a booklet, two pages
 * on each side of a sheet in the order that folds into the right sequence,
 * or as a poster, each page enlarged across a grid of sheets that overlap
 * a little and carry cut marks. Laid out here, as plain numbers, so the
 * order and placement are tested without a PDF; `core/imposePdf.ts` draws
 * the built pages where this says, so the pages themselves (crop, filters,
 * marks, numbers) are exactly what an ordinary export makes.
 *
 * Lengths are PDF points, with the origin at a sheet's top-left (y down),
 * like `layoutPage`.
 */
export type PrintKind = 'pages' | 'booklet' | 'poster'

/** A paper preset, or the document's own page size ("Same as the pages"). */
export type PrintPaper = 'document' | Exclude<PageSizeId, 'custom' | 'image'>

/** What the person picks in Export options. Not kept with the work, like the split. */
export interface PrintOptions {
  kind: PrintKind
  paper: PrintPaper
  /** Poster: sheets side by side, and stacked. */
  across: number
  down: number
  /** Poster: how much neighbouring sheets share, in points. */
  overlap: number
  /** Poster: marks where to cut, and a label on each sheet. */
  cutMarks: boolean
}

export const POSTER_SHEETS_MAX = 8
export const OVERLAP_MAX = toPoints(30, 'mm')

export const DEFAULT_PRINT: PrintOptions = {
  kind: 'pages',
  paper: 'document',
  across: 2,
  down: 2,
  overlap: toPoints(10, 'mm'),
  cutMarks: true,
}

/** What the build needs: the paper resolved to a size (portrait, in points). */
export type Imposition =
  | { kind: 'booklet'; paper: Size }
  | {
      kind: 'poster'
      paper: Size
      across: number
      down: number
      overlap: number
      cutMarks: boolean
    }

export interface Size {
  width: number
  height: number
}

/**
 * The paper the sheets are: the chosen preset, else the document's page
 * size, else (pages sized to their pictures) the local paper.
 */
export const printPaper = (
  paper: PrintPaper,
  settings: Pick<Settings, 'size' | 'custom'>,
  local: Exclude<PageSizeId, 'custom' | 'image'>,
): Size => {
  const size = baseSize({
    size: paper !== 'document' ? paper : settings.size === 'image' ? local : settings.size,
    custom: settings.custom,
  })
  return { width: Math.min(size.width, size.height), height: Math.max(size.width, size.height) }
}

const clampSheets = (n: number) =>
  Math.min(POSTER_SHEETS_MAX, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1))

/** The build's instructions for these options, or none for pages as they are. */
export const imposition = (
  options: PrintOptions,
  settings: Pick<Settings, 'size' | 'custom'>,
  local: Exclude<PageSizeId, 'custom' | 'image'>,
): Imposition | undefined => {
  if (options.kind === 'pages') return undefined
  const paper = printPaper(options.paper, settings, local)
  if (options.kind === 'booklet') return { kind: 'booklet', paper }
  return {
    kind: 'poster',
    paper,
    across: clampSheets(options.across),
    down: clampSheets(options.down),
    // A quarter of the paper at most, so small custom paper still steps forward.
    overlap: Math.min(OVERLAP_MAX, paper.width / 4, Math.max(0, options.overlap)),
    cutMarks: options.cutMarks,
  }
}

/**
 * Saddle-stitch order: for `count` pages, padded with empty slots (null)
 * to a multiple of 4, the [left, right] pages of each side, front then back
 * of each sheet. Stacked and folded down the middle, the sheets read
 * 1, 2, 3… For 8 pages: [8,1] [2,7] [6,3] [4,5] (1-based).
 */
export const bookletOrder = (count: number): [number | null, number | null][] => {
  if (count <= 0) return []
  const total = Math.ceil(count / 4) * 4
  const real = (i: number) => (i < count ? i : null)
  const sides: [number | null, number | null][] = []
  for (let s = 0; s < total / 4; s++) {
    sides.push([real(total - 1 - 2 * s), real(2 * s)])
    sides.push([real(2 * s + 1), real(total - 2 - 2 * s)])
  }
  return sides
}

/** How many sheets of paper (and PDF pages) the print takes. */
export const printCount = (
  options: Pick<PrintOptions, 'kind' | 'across' | 'down'>,
  pageCount: number,
): { sheets: number; sides: number } => {
  if (options.kind === 'booklet') {
    const sheets = Math.ceil(pageCount / 4)
    return { sheets, sides: sheets * 2 }
  }
  const per =
    options.kind === 'poster' ? clampSheets(options.across) * clampSheets(options.down) : 1
  return { sheets: pageCount * per, sides: pageCount * per }
}

/** One built page drawn on a sheet: its top-left corner and its scale. */
export interface Placement {
  /** The page's index in the built document. */
  page: number
  x: number
  y: number
  scale: number
}

/** A straight cut line across a poster sheet, from edge to edge. */
export interface Cut {
  /** `x`: a vertical line at x; `y`: a horizontal line at y. */
  axis: 'x' | 'y'
  at: number
}

export interface PrintSheet {
  size: Size
  pages: Placement[]
  cuts: Cut[]
  /**
   * A poster sheet's place in the grid, "B2" (row B, column 2): its middle,
   * in a strip `strip` wide that runs down the sheet (`across`: the strip's
   * width limits the label's) or along it (its height does).
   */
  label?: { text: string; x: number; y: number; strip: number; across: boolean }
}

/**
 * Each side of a booklet: the sheet turned landscape, folded down the
 * middle. Each page is fitted to its half and set against the fold (centred
 * top to bottom), so facing pages meet at the spine whatever their shape.
 * Print double-sided, flipping on the short edge.
 */
export const bookletSheets = (pages: readonly Size[], paper: Size): PrintSheet[] => {
  const size = { width: paper.height, height: paper.width }
  const half = size.width / 2
  const place = (index: number | null, side: 'left' | 'right'): Placement[] => {
    const page = index === null ? undefined : pages[index]
    if (index === null || !page) return []
    const scale = Math.min(half / page.width, size.height / page.height)
    const w = page.width * scale
    return [
      {
        page: index,
        x: side === 'left' ? half - w : half,
        y: (size.height - page.height * scale) / 2,
        scale,
      },
    ]
  }
  return bookletOrder(pages.length).map(([left, right]) => ({
    size,
    pages: [...place(left, 'left'), ...place(right, 'right')],
    cuts: [],
  }))
}

const ROWS = 'ABCDEFGH'

/**
 * A poster of each page: enlarged to fill `across` × `down` sheets (turned
 * whichever way makes it bigger), centred, and cut into tiles that share
 * `overlap` with each neighbour. Row by row, left to right. On each sheet
 * with a neighbour to the left or above, a cut line marks where to trim
 * that shared strip off, so it lies over the neighbour's copy of it; the
 * label goes in a strip that is cut off or covered.
 */
export const posterSheets = (
  pages: readonly Size[],
  imposition: Extract<Imposition, { kind: 'poster' }>,
): PrintSheet[] => {
  const { paper, across, down, overlap, cutMarks } = imposition
  const marked = cutMarks && overlap > 0
  const span = (sheet: Size) => ({
    width: across * sheet.width - (across - 1) * overlap,
    height: down * sheet.height - (down - 1) * overlap,
  })
  const turned = { width: paper.height, height: paper.width }
  const sheets: PrintSheet[] = []
  pages.forEach((page, index) => {
    const scaleOn = (sheet: Size) => {
      const { width, height } = span(sheet)
      return Math.min(width / page.width, height / page.height)
    }
    const sheet = scaleOn(turned) > scaleOn(paper) + 1e-9 ? turned : paper
    const scale = scaleOn(sheet)
    const { width, height } = span(sheet)
    const w = page.width * scale
    const h = page.height * scale
    const ox = (width - w) / 2
    const oy = (height - h) / 2
    for (let row = 0; row < down; row++) {
      for (let col = 0; col < across; col++) {
        const tx = col * (sheet.width - overlap)
        const ty = row * (sheet.height - overlap)
        // A sheet in the margin round a page of another shape would print blank.
        if (ox >= tx + sheet.width || ox + w <= tx || oy >= ty + sheet.height || oy + h <= ty) {
          continue
        }
        const left = col > 0
        const top = row > 0
        const cuts: Cut[] = marked
          ? [
              ...(left ? [{ axis: 'x' as const, at: overlap }] : []),
              ...(top ? [{ axis: 'y' as const, at: overlap }] : []),
            ]
          : []
        // In a strip that is cut off (left, top) or covered (right, bottom).
        const at = left
          ? { x: overlap / 2, y: sheet.height / 2, room: overlap }
          : top
            ? { x: sheet.width / 2, y: overlap / 2, room: Infinity }
            : col < across - 1
              ? { x: sheet.width - overlap / 2, y: sheet.height / 2, room: overlap }
              : { x: sheet.width / 2, y: sheet.height - overlap / 2, room: Infinity }
        sheets.push({
          size: sheet,
          pages: [{ page: index, x: ox - tx, y: oy - ty, scale }],
          cuts,
          ...(marked && across * down > 1
            ? {
                label: {
                  text: `${ROWS[row] ?? ''}${String(col + 1)}`,
                  x: at.x,
                  y: at.y,
                  strip: overlap,
                  across: at.room !== Infinity,
                },
              }
            : {}),
        })
      }
    }
  })
  return sheets
}

/** The sheets for an imposition. */
export const printSheets = (pages: readonly Size[], imposition: Imposition): PrintSheet[] =>
  imposition.kind === 'booklet'
    ? bookletSheets(pages, imposition.paper)
    : posterSheets(pages, imposition)
