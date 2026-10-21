import { applyFilter, filterEncoding } from '../core/filters'
import type { Filter } from '../core/model'
import type { ImageJob } from '../core/pdf'

/**
 * Canvas side of filters and compression, usable in the page and in a worker
 * (OffscreenCanvas). Decoding with createImageBitmap applies EXIF orientation,
 * so the output is upright.
 *
 * iOS Safari refuses canvases over ~16.7 megapixels; larger images are scaled
 * to fit, which still leaves a US Letter page well above 300 dpi.
 */
export const MAX_CANVAS_PIXELS = 16_000_000

const render = async (
  source: Blob,
  size: (natural: { width: number; height: number }) => { width: number; height: number },
  filter: Filter,
  encode: { type: string; quality?: number },
): Promise<Blob> => {
  const bitmap = await createImageBitmap(source)
  try {
    const wanted = size({ width: bitmap.width, height: bitmap.height })
    const cap = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (wanted.width * wanted.height)))
    const width = Math.max(1, Math.round(wanted.width * cap))
    const height = Math.max(1, Math.round(wanted.height * cap))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: filter !== 'original' })
    if (!ctx) throw new Error('No canvas available to process the image.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    if (filter !== 'original') {
      const pixels = ctx.getImageData(0, 0, width, height)
      applyFilter(pixels.data, width, height, filter)
      ctx.putImageData(pixels, 0, 0)
    }
    return await canvas.convertToBlob(
      encode.quality === undefined
        ? { type: encode.type }
        : { type: encode.type, quality: encode.quality },
    )
  } finally {
    bitmap.close()
  }
}

/** A filtered copy at the source's own size, for previews. */
export const filterToBlob = (source: Blob, filter: Exclude<Filter, 'original'>) =>
  render(source, (natural) => natural, filter, filterEncoding(filter))

/** An export job: filter, resize to the job's pixels, encode as the job says. */
export const processToBlob = (source: Blob, job: ImageJob) =>
  render(
    source,
    () => ({ width: job.width, height: job.height }),
    job.filter,
    job.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: job.quality },
  )
