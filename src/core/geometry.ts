import type { Asset, Page, Settings } from './model'
import { contentSize, pageRotation } from './model'
import { pageSize } from './pageSizes'
import { PAGE_MAX, PAGE_MIN } from './limits'
import { PT_PER_IN } from './units'

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

/**
 * Where an image goes on its page. The single source of truth for both the
 * on-screen preview and the PDF, so the export matches what you see.
 *
 * The image is fitted by its rotated bounding box (so a straightened scan never
 * pokes out of the printable area at scale 1), then multiplied by the page's
 * scale, and always centred.
 */
export const layoutPage = (
  settings: Pick<Settings, 'size' | 'custom' | 'orientation' | 'margin' | 'imageDpi'>,
  asset: Pick<Asset, 'width' | 'height'> & Partial<Pick<Asset, 'format'>>,
  page: Pick<Page, 'turns' | 'angle' | 'scale' | 'fit'> & Partial<Pick<Page, 'corners'>>,
): Layout => {
  // What the page shows: the whole image, or the corrected crop.
  const source = { ...asset, ...contentSize(asset, page) }
  const size =
    settings.size === 'image'
      ? matchedSize(settings, source, pageRotation(page))
      : pageSize(settings, isLandscape(source, page))
  // Margins can't eat the whole page; keep at least 10% of each side printable.
  const margin = Math.max(0, Math.min(settings.margin, size.width * 0.45, size.height * 0.45))
  const content: Rect = {
    x: margin,
    y: margin,
    width: size.width - margin * 2,
    height: size.height - margin * 2,
  }

  const rotation = pageRotation(page)
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
