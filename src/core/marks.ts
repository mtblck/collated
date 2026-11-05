import type { Layout } from './geometry'
import type { Asset, DocState, Mark, Page } from './model'
import { picturesOf } from './model'

/**
 * Marks: what is put on a page over its pictures (#111 signatures, #112
 * text and stamps). One placement model for all of them: a middle in
 * fractions of the page, a size, and a small clockwise turn. Pure geometry
 * here; the preview draws them with CSS from `markBox`, the export with
 * pdf-lib from the same box, so both put them in the same place.
 */

/** A mark turns at most this far either way: a signature sits on a line, not up a margin. */
export const MARK_ANGLE_LIMIT = 30
/** Narrowest and widest a picture mark may be, as a share of the page's width. */
export const MARK_MIN_WIDTH = 0.03
export const MARK_MAX_WIDTH = 1
/** A new signature is about this wide on paper (points): a written name. */
export const SIGNATURE_WIDTH = 160

const clamp = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min

/** One mark kept on its page (its middle on the paper) and within its size and turn limits. */
export const cleanMark = (mark: Mark): Mark => ({
  ...mark,
  x: clamp(mark.x, 0, 1),
  y: clamp(mark.y, 0, 1),
  angle: clamp(mark.angle, -MARK_ANGLE_LIMIT, MARK_ANGLE_LIMIT),
  width: clamp(mark.width, MARK_MIN_WIDTH, MARK_MAX_WIDTH),
})

export const cleanMarks = (marks: readonly Mark[]): Mark[] => marks.map(cleanMark)

/** Whether a page carries any marks. */
export const hasMarks = (page: Pick<Page, 'marks'>) => (page.marks?.length ?? 0) > 0

/** Every asset a page uses: its pictures' and its marks'. */
export const assetIdsOf = (page: Page): string[] => [
  ...picturesOf(page).map((slot) => slot.assetId),
  ...(page.marks ?? []).map((mark) => mark.assetId),
]

/** Every asset any page of the document uses. */
export const usedAssetIds = (state: Pick<DocState, 'pages'>) =>
  new Set(state.pages.flatMap(assetIdsOf))

/**
 * Where a mark goes on a page of `page` points: its middle, size and turn,
 * in the shape of `Layout['image']` (screen space, y down, turned
 * clockwise about its middle), so the export places it like a picture.
 */
export const markBox = (
  mark: Mark,
  page: { width: number; height: number },
  asset: Pick<Asset, 'width' | 'height'>,
): Layout['image'] => {
  const width = mark.width * page.width
  return {
    cx: mark.x * page.width,
    cy: mark.y * page.height,
    width,
    height: (width * asset.height) / Math.max(1, asset.width),
    rotation: mark.angle,
  }
}

/** A mark ready to draw: its picture and its box on the page. */
export interface PlacedMark {
  id: string
  src: string
  box: Layout['image']
}

/** A page's marks as the preview draws them; marks whose picture is missing are left out. */
export const placedMarks = (
  page: Pick<Page, 'marks'>,
  size: { width: number; height: number },
  assets: Readonly<Record<string, Pick<Asset, 'width' | 'height' | 'thumbUrl'> | undefined>>,
): PlacedMark[] =>
  (page.marks ?? []).flatMap((mark) => {
    const asset = assets[mark.assetId]
    return asset ? [{ id: mark.id, src: asset.thumbUrl, box: markBox(mark, size, asset) }] : []
  })

/**
 * A new signature on a page: about `SIGNATURE_WIDTH` points wide (never
 * more than half the page), level, its middle at `at` (fractions; by
 * default low on the page, where signature lines usually are).
 */
export const newSignature = (
  id: string,
  assetId: string,
  page: { width: number },
  at: { x: number; y: number } = { x: 0.5, y: 0.75 },
): Mark =>
  cleanMark({
    id,
    kind: 'signature',
    assetId,
    x: at.x,
    y: at.y,
    angle: 0,
    width: Math.min(0.5, SIGNATURE_WIDTH / Math.max(1, page.width)),
  })
