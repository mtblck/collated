import { QUALITY_PRESETS } from './compression'
import type { Quality } from './model'
import { PT_PER_IN } from './units'

/**
 * What an export makes (#117): one PDF (or a ZIP of several), or each page
 * as an image, for upload forms that won't take a PDF.
 */
export type ExportFormat = 'pdf' | 'jpg' | 'png'

export type ImageFormat = Exclude<ExportFormat, 'pdf'>

export const isImageFormat = (format: ExportFormat): format is ImageFormat => format !== 'pdf'

export const IMAGE_TYPES: Record<ImageFormat, { mime: string; ext: string; label: string }> = {
  jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' },
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
}

/** "1 JPG", "3 PNGs". */
export const imagesWord = (n: number, format: ImageFormat) =>
  `${String(n)} ${IMAGE_TYPES[format].label}${n === 1 ? '' : 's'}`

/**
 * Original keeps every picture as it is in the PDF, but an image of the page
 * needs a resolution of its own: print quality, like High.
 */
const ORIGINAL = { dpi: 300, quality: 0.92 }

/** The resolution pages are drawn at, and the JPEG quality, for an export quality. */
export const imageCompression = (quality: Quality) =>
  quality === 'original' ? ORIGINAL : QUALITY_PRESETS[quality]

/**
 * The pixel size of a page drawn at `dpi`, scaled down to stay under
 * `maxPixels` (Safari won't draw larger canvases) but never below one pixel.
 */
export const pagePixels = (
  widthPt: number,
  heightPt: number,
  dpi: number,
  maxPixels: number,
): { width: number; height: number; scale: number } => {
  let scale = dpi / PT_PER_IN
  const area = widthPt * scale * heightPt * scale
  if (area > maxPixels) scale *= Math.sqrt(maxPixels / area)
  const size = (round: (n: number) => number) => ({
    width: Math.max(1, round(widthPt * scale)),
    height: Math.max(1, round(heightPt * scale)),
  })
  // Nearest pixel, unless rounding up tips it over the cap (down never does).
  const near = size(Math.round)
  return { ...(near.width * near.height > maxPixels ? size(Math.floor) : near), scale }
}
