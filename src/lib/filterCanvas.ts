import { applyFilter, filterEncoding } from '../core/filters'
import type { Filter } from '../core/model'

/**
 * Canvas side of the document filters, usable in the page and in a worker
 * (OffscreenCanvas). Decoding with createImageBitmap applies EXIF orientation,
 * so the output is upright.
 *
 * iOS Safari refuses canvases over ~16.7 megapixels; larger images are scaled
 * to fit, which still leaves a US Letter page well above 300 dpi.
 */
export const MAX_FILTER_PIXELS = 16_000_000

export const filterToBlob = async (
  source: Blob,
  filter: Exclude<Filter, 'original'>,
  maxEdge = Infinity,
): Promise<Blob> => {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(
      1,
      maxEdge / Math.max(bitmap.width, bitmap.height),
      Math.sqrt(MAX_FILTER_PIXELS / (bitmap.width * bitmap.height)),
    )
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('No canvas available to apply the filter.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const pixels = ctx.getImageData(0, 0, width, height)
    applyFilter(pixels.data, width, height, filter)
    ctx.putImageData(pixels, 0, 0)
    const encoding = filterEncoding(filter)
    return await canvas.convertToBlob(
      'quality' in encoding
        ? { type: encoding.type, quality: encoding.quality }
        : { type: encoding.type },
    )
  } finally {
    bitmap.close()
  }
}
