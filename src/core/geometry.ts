import type { Asset, Page, Settings, SheetKind, Slot } from './model'
import { SHEET_CAPACITY, contentSize, pageRotation } from './model'
import { pageSize } from './pageSizes'
import { PAGE_MAX, PAGE_MIN } from './limits'
import { PT_PER_IN, toPoints } from './units'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Layout {
  /** Page size in points. */
  page: { width: number; height: number }
  /** The printable area inside the margins. The image is clipped to it. */
  content: Rect
  /**
   * The upright image, centred on (cx, cy), drawn at width × height and then
   * turned `rotation` degrees clockwise about its centre. Screen convention:
   * origin top-left, y down. The PDF export flips y.
   */
  image: { cx: number; cy: number; width: number; height: number; rotation: number }
  /** Pixels per inch of the image as printed — tells you if a scan is too small. */
  dpi: number
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

/** Axis-aligned bounding box of a w × h rectangle rotated by `degrees`. */
export const rotatedBounds = (width: number, height: number, degrees: number) => {
  // Quarter turns exactly: cos(90°) is 6e-17 in floating point, which leaks
  // into page sizes ("120.00000000000001 pt").
  if (degrees % 90 === 0) {
    return Math.abs(degrees / 90) % 2 === 1 ? { width: height, height: width } : { width, height }
  }
  const r = toRadians(degrees)
  const cos = Math.abs(Math.cos(r))
  const sin = Math.abs(Math.sin(r))
  return { width: width * cos + height * sin, height: width * sin + height * cos }
}

/** Whether the image sits landscape on the page after the user's quarter turns. */
export const isLandscape = (asset: Pick<Asset, 'width' | 'height'>, page: Pick<Page, 'turns'>) => {
  const odd = page.turns % 2 === 1
  return odd ? asset.height > asset.width : asset.width > asset.height
}

/**
 * A "match image" page: the content's rotated bounds at its natural size
 * (images at `imageDpi`, PDF pages in their own points) plus the margins, so
 * at scale 1 it fills the page exactly. Clamped to PDF's page-size limits.
 */
const matchedSize = (
  settings: Pick<Settings, 'margin' | 'imageDpi'>,
  asset: Pick<Asset, 'width' | 'height'> & Partial<Pick<Asset, 'format'>>,
  rotation: number,
) => {
  const perUnit = asset.format === 'pdf' ? 1 : PT_PER_IN / settings.imageDpi
  const bounds = rotatedBounds(asset.width * perUnit, asset.height * perUnit, rotation)
  const fit = (n: number) => Math.min(PAGE_MAX, Math.max(PAGE_MIN, n + settings.margin * 2))
  return { width: fit(bounds.width), height: fit(bounds.height) }
}

/** Margins can't eat the whole page; keep at least 10% of each side printable. */
const printable = (size: { width: number; height: number }, margin: number): Rect => {
  const m = Math.max(0, Math.min(margin, size.width * 0.45, size.height * 0.45))
  return { x: m, y: m, width: size.width - m * 2, height: size.height - m * 2 }
}

/** A page of a given size, and the part of it one picture is placed in. */
export interface Cell {
  page: { width: number; height: number }
  content: Rect
}

/**
 * Where an image goes on its page. The single source of truth for both the
 * on-screen preview and the PDF, so the export matches what you see.
 *
 * The image is fitted by its rotated bounding box (so a straightened scan never
 * pokes out of the printable area at scale 1), then multiplied by the page's
 * scale, and always centred. On a combined page (#76) `cell` gives the page
 * and the picture's part of it, from `layoutSheet`; the picture is fitted,
 * scaled, centred and clipped to that part instead.
 */
export const layoutPage = (
  settings: Pick<Settings, 'size' | 'custom' | 'orientation' | 'margin' | 'imageDpi'>,
  asset: Pick<Asset, 'width' | 'height'> & Partial<Pick<Asset, 'format'>>,
  page: Pick<Page, 'turns' | 'angle' | 'scale' | 'fit'> & Partial<Pick<Page, 'corners'>>,
  cell?: Cell,
): Layout => {
  // What the page shows: the whole image, or the corrected crop.
  const source = { ...asset, ...contentSize(asset, page) }
  const rotation = pageRotation(page)
  let size: { width: number; height: number }
  let content: Rect
  if (cell) {
    size = cell.page
    content = cell.content
  } else {
    size =
      settings.size === 'image'
        ? matchedSize(settings, source, rotation)
        : pageSize(settings, isLandscape(source, page))
    content = printable(size, settings.margin)
  }

  const bounds = rotatedBounds(source.width, source.height, rotation)
  const fitX = content.width / bounds.width
  const fitY = content.height / bounds.height
  const fitted = page.fit === 'cover' ? Math.max(fitX, fitY) : Math.min(fitX, fitY)
  const scale = fitted * page.scale

  const width = source.width * scale
  const height = source.height * scale
  return {
    page: size,
    content,
    image: {
      cx: content.x + content.width / 2,
      cy: content.y + content.height / 2,
      width,
      height,
      rotation,
    },
    dpi: source.width / (width / PT_PER_IN),
  }
}

/** A whole page: its size, its printable area, and each picture's layout. */
export interface SheetLayout {
  page: { width: number; height: number }
  content: Rect
  /** One per picture, in slot order; each one's `content` is its cell. */
  pictures: Layout[]
}

/** Space between the pictures on a combined page: a quarter inch, to cut along. */
export const SHEET_GAP = 18

/** An ID-1 card (ID cards, driving licences, bank cards): 85.6 × 54 mm, ISO/IEC 7810. */
export const ID_CARD = { width: toPoints(85.6, 'mm'), height: toPoints(54, 'mm') }

type SizedAsset = Pick<Asset, 'width' | 'height'> & Partial<Pick<Asset, 'format'>>

/** A single picture's page as a sheet, so every page draws the same way. */
export const singleSheet = (layout: Layout): SheetLayout => ({
  page: layout.page,
  content: layout.content,
  pictures: [layout],
})

/** `n` cells of `cols` columns filling `area`, with gaps between them. */
const gridCells = (area: Rect, n: number, cols: number): Rect[] => {
  const rows = Math.ceil(n / cols)
  const width = (area.width - SHEET_GAP * (cols - 1)) / cols
  const height = (area.height - SHEET_GAP * (rows - 1)) / rows
  return Array.from({ length: n }, (_, i) => ({
    x: area.x + (i % cols) * (width + SHEET_GAP),
    y: area.y + Math.floor(i / cols) * (height + SHEET_GAP),
    width,
    height,
  }))
}

/**
 * Card-sized cells, one above the other and centred on `area`: landscape,
 * unless the picture in it stands upright. Shrunk together if the area is
 * too small for them at real size (never enlarged).
 */
const cardCells = (area: Rect, upright: readonly boolean[]): Rect[] => {
  const sizes = upright.map((tall) =>
    tall ? { width: ID_CARD.height, height: ID_CARD.width } : ID_CARD,
  )
  const blockW = Math.max(...sizes.map((s) => s.width))
  const blockH = sizes.reduce((sum, s) => sum + s.height, 0) + SHEET_GAP * (sizes.length - 1)
  const k = Math.min(1, area.width / blockW, area.height / blockH)
  let y = area.y + (area.height - blockH * k) / 2
  return sizes.map((s) => {
    const cell = {
      x: area.x + (area.width - s.width * k) / 2,
      y,
      width: s.width * k,
      height: s.height * k,
    }
    y += (s.height + SHEET_GAP) * k
    return cell
  })
}

/** Total area the pictures cover when fitted into their cells at scale 1. */
const coverage = (
  pictures: readonly { asset: SizedAsset; slot: Slot }[],
  cells: readonly Rect[],
): number =>
  pictures.reduce((sum, { asset, slot }, i) => {
    const cell = cells[i]
    if (!cell) return sum
    const source = contentSize(asset, slot)
    const b = rotatedBounds(source.width, source.height, pageRotation(slot))
    const k = Math.min(cell.width / b.width, cell.height / b.height)
    return sum + b.width * k * b.height * k
  }, 0)

/**
 * Where everything goes on a page: one picture through `layoutPage`, or a
 * combined page's pictures (#76), each through `layoutPage` with its cell.
 *
 * Two pictures sit along the page's long side, four in a 2 × 2 grid; with
 * Auto orientation the page turns whichever way shows the pictures larger.
 * An ID card page puts each side at real card size. "Match image" pages are
 * sized to hold the pictures at their own size, plus the margins.
 */
export const layoutSheet = (
  settings: Pick<Settings, 'size' | 'custom' | 'orientation' | 'margin' | 'imageDpi'>,
  assets: Readonly<Record<string, SizedAsset | undefined>>,
  page: Page,
  like?: Page,
): SheetLayout => {
  const missing = () => new Error('A page refers to missing content.')
  if (page.blank) return blankSheet(settings, assets, page, like)
  if (!page.sheet) {
    const asset = assets[page.assetId]
    if (!asset) throw missing()
    return singleSheet(layoutPage(settings, asset, page))
  }
  const { kind } = page.sheet
  const pictures = page.sheet.slots.map((slot) => {
    const asset = assets[slot.assetId]
    if (!asset) throw missing()
    return { asset, slot }
  })
  const upright = pictures.map(({ asset, slot }) => !isLandscape(contentSize(asset, slot), slot))

  const sheetFor = (size: { width: number; height: number }) => {
    const content = printable(size, settings.margin)
    const cells =
      kind === 'id-card'
        ? cardCells(content, upright)
        : // A sheet that isn't full keeps its empty cells, so pictures match in size.
          gridCells(
            content,
            SHEET_CAPACITY[kind],
            kind === 'four' || size.width > size.height ? 2 : 1,
          )
    return { page: size, content, cells }
  }

  let sheet: ReturnType<typeof sheetFor>
  if (settings.size === 'image') {
    sheet = sheetFor(packedSize(settings, kind, pictures, upright))
  } else {
    const orientations =
      settings.orientation === 'auto' ? [false, true] : [settings.orientation === 'landscape']
    const candidates = orientations.map((landscape) => sheetFor(pageSize(settings, landscape)))
    // Portrait unless landscape shows the pictures larger.
    sheet = candidates.reduce((best, next) =>
      coverage(pictures, next.cells) > coverage(pictures, best.cells) * 1.001 ? next : best,
    )
  }
  return {
    page: sheet.page,
    content: sheet.content,
    pictures: pictures.map(({ asset, slot }, i) =>
      layoutPage(settings, asset, slot, {
        page: sheet.page,
        content: sheet.cells[i] ?? sheet.content,
      }),
    ),
  }
}

/**
 * An inserted blank page (#80): the page setup's size, portrait unless
 * turned (with Auto orientation) or set landscape. A "match image" blank
 * takes the size of `like` (see `sizeModel`), turned with it; Letter when
 * there is no page to match.
 */
const blankSheet = (
  settings: Pick<Settings, 'size' | 'custom' | 'orientation' | 'margin' | 'imageDpi'>,
  assets: Readonly<Record<string, SizedAsset | undefined>>,
  page: Page,
  like: Page | undefined,
): SheetLayout => {
  const turned = page.turns % 2 === 1
  let size: { width: number; height: number }
  if (settings.size === 'image' && like && !like.blank) {
    const model = layoutSheet(settings, assets, like).page
    size = turned ? { width: model.height, height: model.width } : model
  } else {
    size = pageSize(settings, turned)
  }
  return { page: size, content: printable(size, settings.margin), pictures: [] }
}

/** A "match image" combined page: room for each picture at its own size. */
const packedSize = (
  settings: Pick<Settings, 'margin' | 'imageDpi'>,
  kind: SheetKind,
  pictures: readonly { asset: SizedAsset; slot: Slot }[],
  upright: readonly boolean[],
) => {
  const fit = (n: number) => Math.min(PAGE_MAX, Math.max(PAGE_MIN, n + settings.margin * 2))
  if (kind === 'id-card') {
    const width = Math.max(...upright.map((tall) => (tall ? ID_CARD.height : ID_CARD.width)))
    const height =
      upright.reduce((sum, tall) => sum + (tall ? ID_CARD.width : ID_CARD.height), 0) +
      SHEET_GAP * (upright.length - 1)
    return { width: fit(width), height: fit(height) }
  }
  // Every cell is as big as the biggest picture, so none is shrunk.
  const natural = pictures.map(({ asset, slot }) => {
    const source = { ...asset, ...contentSize(asset, slot) }
    const perUnit = asset.format === 'pdf' ? 1 : PT_PER_IN / settings.imageDpi
    return rotatedBounds(source.width * perUnit, source.height * perUnit, pageRotation(slot))
  })
  const cellW = Math.max(...natural.map((b) => b.width))
  const cellH = Math.max(...natural.map((b) => b.height))
  // Two wide pictures stack; two tall ones sit side by side.
  const cols = kind === 'four' ? 2 : cellW > cellH ? 1 : 2
  const rows = SHEET_CAPACITY[kind] / cols
  return {
    width: fit(cellW * cols + SHEET_GAP * (cols - 1)),
    height: fit(cellH * rows + SHEET_GAP * (rows - 1)),
  }
}

/** Part of an image as fractions of its upright width and height. */
export interface Part {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Below this hidden share of a side, an overflow is treated as rounding. */
const HIDDEN_TOLERANCE = 0.005

/**
 * The part of the image the printable area shows, when the page hides some
 * of it (Fill, or scaled past 100%): the image-space bounding box of the
 * printable area, clamped to the image. Null when the whole image shows.
 *
 * The export stores only this part, so what the page hides isn't in the file.
 */
export const visiblePart = (layout: Layout): Part | null => {
  const { cx, cy, width, height, rotation } = layout.image
  const { x, y, width: w, height: h } = layout.content
  const r = toRadians(rotation)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const us: number[] = []
  const vs: number[] = []
  for (const [px, py] of [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as const) {
    // Undo the clockwise turn (screen space, y down) about the image centre.
    const dx = px - cx
    const dy = py - cy
    us.push((dx * cos + dy * sin) / width + 0.5)
    vs.push((-dx * sin + dy * cos) / height + 0.5)
  }
  const clamp = (n: number) => Math.min(1, Math.max(0, n))
  const part = {
    x0: clamp(Math.min(...us)),
    y0: clamp(Math.min(...vs)),
    x1: clamp(Math.max(...us)),
    y1: clamp(Math.max(...vs)),
  }
  const t = HIDDEN_TOLERANCE
  if (part.x0 <= t && part.y0 <= t && part.x1 >= 1 - t && part.y1 >= 1 - t) return null
  return part
}

/** The layout of just `part` of the image: same place on the page, smaller. */
export const partLayout = (layout: Layout, part: Part): Layout => {
  const { cx, cy, width, height, rotation } = layout.image
  const lx = ((part.x0 + part.x1) / 2 - 0.5) * width
  const ly = ((part.y0 + part.y1) / 2 - 0.5) * height
  const r = toRadians(rotation)
  return {
    ...layout,
    image: {
      cx: cx + lx * Math.cos(r) - ly * Math.sin(r),
      cy: cy + lx * Math.sin(r) + ly * Math.cos(r),
      width: width * (part.x1 - part.x0),
      height: height * (part.y1 - part.y0),
      rotation,
    },
  }
}

/**
 * `part` widened to whole pixels of a `width` × `height` image, so cropping
 * copies pixels rather than resampling them (a fractional edge blurs the
 * whole image).
 */
export const snapPart = (part: Part, width: number, height: number): Part => ({
  x0: Math.floor(part.x0 * width + 1e-9) / width,
  y0: Math.floor(part.y0 * height + 1e-9) / height,
  x1: Math.ceil(part.x1 * width - 1e-9) / width,
  y1: Math.ceil(part.y1 * height - 1e-9) / height,
})
