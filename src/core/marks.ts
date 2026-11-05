import type { Layout } from './geometry'
import type { Asset, DocState, ImageMark, Mark, Page, StampMark, TextMark } from './model'
import { picturesOf } from './model'
import { textWidth, unsupportedCharacters } from './watermark'

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

/** Smallest and largest tick or cross, as a share of the page's width: a form's box, up to a big tick. */
export const STAMP_MIN_WIDTH = 0.01
export const STAMP_MAX_WIDTH = 0.5
/** Smallest and largest typed text, as a share of the page's width (about 5 and 150 pt on A4). */
export const TEXT_MIN_SIZE = 0.008
export const TEXT_MAX_SIZE = 0.25
/** Lines of text are this many font sizes apart. */
export const TEXT_LINE_HEIGHT = 1.2
/** A line's baseline sits this many font sizes below its top: room for accented capitals. */
const TEXT_ASCENT = 0.93
/** The longest text one mark holds: a form's field, not a letter. */
export const TEXT_MAX_LENGTH = 500
/** New text is about 12 pt on paper; a tick or cross about 18 pt square. */
export const TEXT_SIZE = 12
export const STAMP_WIDTH = 18

/** The pens marks are drawn in: black ink first. */
export const MARK_COLOURS = [
  { name: 'Black', hex: '#000000' },
  { name: 'Blue', hex: '#1d3fb8' },
  { name: 'Red', hex: '#c0262d' },
] as const
const DEFAULT_COLOUR = MARK_COLOURS[0].hex
const cleanColour = (hex: string) =>
  /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : DEFAULT_COLOUR

/** Whether a mark is drawn from a picture (a signature) rather than as text or strokes. */
export const isImageMark = (mark: Mark): mark is ImageMark => mark.kind === 'signature'

/** A mark's size: a text's font size, or a picture's or stamp's width (fractions of the page's width). */
export const sizeOf = (mark: Mark) => (mark.kind === 'text' ? mark.size : mark.width)

/** The smallest and largest `sizeOf` a mark may have. */
export const sizeLimits = (mark: Pick<Mark, 'kind'>) =>
  mark.kind === 'text'
    ? { min: TEXT_MIN_SIZE, max: TEXT_MAX_SIZE }
    : mark.kind === 'signature'
      ? { min: MARK_MIN_WIDTH, max: MARK_MAX_WIDTH }
      : { min: STAMP_MIN_WIDTH, max: STAMP_MAX_WIDTH }

/** The mark at another size (cleaned by `cleanMark`). */
export const withSize = (mark: Mark, size: number): Mark =>
  mark.kind === 'text' ? { ...mark, size } : { ...mark, width: size }

/** One mark kept on its page (its middle on the paper) and within its size and turn limits. */
export const cleanMark = <M extends Mark>(mark: M): M => {
  const clean = (m: Mark) => m as M
  const place = {
    x: clamp(mark.x, 0, 1),
    y: clamp(mark.y, 0, 1),
    angle: clamp(mark.angle, -MARK_ANGLE_LIMIT, MARK_ANGLE_LIMIT),
  }
  const { min, max } = sizeLimits(mark)
  if (mark.kind === 'text') {
    return clean({
      ...mark,
      ...place,
      text: mark.text.replace(/\r\n?/g, '\n').slice(0, TEXT_MAX_LENGTH),
      size: clamp(mark.size, min, max),
      colour: cleanColour(mark.colour),
    })
  }
  const width = clamp(mark.width, min, max)
  return clean(
    mark.kind === 'signature'
      ? { ...mark, ...place, width }
      : { ...mark, ...place, width, colour: cleanColour(mark.colour) },
  )
}

export const cleanMarks = (marks: readonly Mark[]): Mark[] => marks.map(cleanMark)

/** Whether a page carries any marks. */
export const hasMarks = (page: Pick<Page, 'marks'>) => (page.marks?.length ?? 0) > 0

/** Every asset a page uses: its pictures' and its signatures'. */
export const assetIdsOf = (page: Page): string[] => [
  ...picturesOf(page).map((slot) => slot.assetId),
  ...(page.marks ?? []).flatMap((mark) => (isImageMark(mark) ? [mark.assetId] : [])),
]

/**
 * Whether a mark can be drawn: a signature needs its picture, text needs
 * something to say. Others are dropped (they would only fail the export, or
 * leave an empty box nobody can see).
 */
export const markReady = (mark: Mark, assets: Readonly<Record<string, unknown>>): boolean =>
  isImageMark(mark)
    ? mark.assetId in assets && assets[mark.assetId] !== undefined
    : mark.kind === 'text'
      ? mark.text.trim() !== ''
      : true

/** Every asset any page of the document uses. */
export const usedAssetIds = (state: Pick<DocState, 'pages'>) =>
  new Set(state.pages.flatMap(assetIdsOf))

/** Text laid out: its font size in points, its box, and each line's baseline from the box's top. */
export const textLayout = (mark: Pick<TextMark, 'text' | 'size'>, pageWidth: number) => {
  const size = mark.size * pageWidth
  const lines = mark.text.split('\n')
  const width = Math.max(size * 0.6, ...lines.map((line) => textWidth(line, size)))
  return {
    size,
    width,
    height: lines.length * size * TEXT_LINE_HEIGHT,
    lines: lines.map((text, i) => ({
      text,
      baseline: (i * TEXT_LINE_HEIGHT + TEXT_ASCENT) * size,
    })),
  }
}

/** Characters a text mark has that its font can't write (see `unsupportedCharacters`). */
export const markTextProblems = (mark: Mark) =>
  mark.kind === 'text' ? unsupportedCharacters(mark.text.replace(/\n/g, '')) : []

/**
 * The strokes of a tick and a cross, in a unit square (y down), drawn with
 * round ends `STAMP_STROKE` of the side wide: the same polylines in the
 * preview (SVG), the export (PDF paths) and the burn-in canvas.
 */
export const STAMP_PATHS: Record<
  StampMark['kind'],
  readonly (readonly (readonly [number, number])[])[]
> = {
  tick: [
    [
      [0.14, 0.55],
      [0.4, 0.8],
      [0.88, 0.2],
    ],
  ],
  cross: [
    [
      [0.2, 0.2],
      [0.8, 0.8],
    ],
    [
      [0.8, 0.2],
      [0.2, 0.8],
    ],
  ],
}
export const STAMP_STROKE = 0.13

/**
 * Where a mark goes on a page of `page` points: its middle, size and turn,
 * in the shape of `Layout['image']` (screen space, y down, turned
 * clockwise about its middle), so the export places it like a picture.
 * A signature's height follows its picture (`asset`); without one, null.
 */
export function markBox(
  mark: Mark,
  page: { width: number; height: number },
  asset: Pick<Asset, 'width' | 'height'>,
): Layout['image']
export function markBox(
  mark: Mark,
  page: { width: number; height: number },
  asset?: Pick<Asset, 'width' | 'height'>,
): Layout['image'] | null
export function markBox(
  mark: Mark,
  page: { width: number; height: number },
  asset?: Pick<Asset, 'width' | 'height'>,
): Layout['image'] | null {
  const at = { cx: mark.x * page.width, cy: mark.y * page.height, rotation: mark.angle }
  if (mark.kind === 'text') {
    const { width, height } = textLayout(mark, page.width)
    return { ...at, width, height }
  }
  const width = mark.width * page.width
  if (mark.kind !== 'signature') return { ...at, width, height: width }
  if (!asset) return null
  return { ...at, width, height: (width * asset.height) / Math.max(1, asset.width) }
}

/** A mark drawn as text or strokes rather than a picture: what the preview, export and burn-in all need. */
export type VectorMark =
  | {
      kind: 'text'
      box: Layout['image']
      /** Font size in points. */
      size: number
      colour: string
      lines: readonly { text: string; baseline: number }[]
    }
  | {
      kind: 'stamp'
      box: Layout['image']
      colour: string
      paths: (typeof STAMP_PATHS)[StampMark['kind']]
    }

/** A text or stamp mark ready to draw on a page of `page` points. */
export const vectorMark = (
  mark: TextMark | StampMark,
  page: { width: number; height: number },
): VectorMark => {
  const at = { cx: mark.x * page.width, cy: mark.y * page.height, rotation: mark.angle }
  if (mark.kind === 'text') {
    const { size, width, height, lines } = textLayout(mark, page.width)
    return { kind: 'text', box: { ...at, width, height }, size, colour: mark.colour, lines }
  }
  const side = mark.width * page.width
  return {
    kind: 'stamp',
    box: { ...at, width: side, height: side },
    colour: mark.colour,
    paths: STAMP_PATHS[mark.kind],
  }
}

/** A mark ready to draw: a picture and its box, or text and strokes. */
export type PlacedMark = { id: string } & (
  { kind: 'image'; src: string; box: Layout['image'] } | VectorMark
)

/** A page's marks as the preview draws them; signatures whose picture is missing are left out. */
export const placedMarks = (
  page: Pick<Page, 'marks'>,
  size: { width: number; height: number },
  assets: Readonly<Record<string, Pick<Asset, 'width' | 'height' | 'thumbUrl'> | undefined>>,
): PlacedMark[] =>
  (page.marks ?? []).flatMap((mark): PlacedMark[] => {
    if (!isImageMark(mark)) return [{ id: mark.id, ...vectorMark(mark, size) }]
    const asset = assets[mark.assetId]
    const box = markBox(mark, size, asset)
    return asset && box ? [{ id: mark.id, kind: 'image', src: asset.thumbUrl, box }] : []
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
): ImageMark =>
  cleanMark({
    id,
    kind: 'signature',
    assetId,
    x: at.x,
    y: at.y,
    angle: 0,
    width: Math.min(0.5, SIGNATURE_WIDTH / Math.max(1, page.width)),
  })

/**
 * New text on a page (#112): about `TEXT_SIZE` points, black, level, its
 * middle at `at`. Empty until typed into; empty text is dropped on Apply.
 */
export const newText = (
  id: string,
  page: { width: number },
  at: { x: number; y: number },
  text = '',
  colour: string = DEFAULT_COLOUR,
): TextMark =>
  cleanMark({
    id,
    kind: 'text',
    text,
    x: at.x,
    y: at.y,
    angle: 0,
    size: TEXT_SIZE / Math.max(1, page.width),
    colour,
  })

/** A new tick or cross, about `STAMP_WIDTH` points square. */
export const newStamp = (
  id: string,
  kind: StampMark['kind'],
  page: { width: number },
  at: { x: number; y: number },
  colour: string = DEFAULT_COLOUR,
): StampMark =>
  cleanMark({
    id,
    kind,
    x: at.x,
    y: at.y,
    angle: 0,
    width: STAMP_WIDTH / Math.max(1, page.width),
    colour,
  })

/**
 * Today's date as the person's device writes it, in characters the text's
 * font has: the locale's medium date ("5 Nov 2026", "Nov 5, 2026"), or the
 * ISO date where the locale needs other letters.
 */
export const todayText = (now = new Date(), locale?: string) => {
  let text = ''
  try {
    text = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
      .format(now)
      .replace(/[\u202f\u2009]/g, ' ')
  } catch {
    // No such locale: the ISO date below.
  }
  if (text && unsupportedCharacters(text).length === 0) return text
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
