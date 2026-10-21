import { applyFilter, filterEncoding } from '../core/filters'
import type { Filter } from '../core/model'
import type { ImageJob } from '../core/pdf'
import { rotatedBounds, type Part } from '../core/geometry'
import { toPixels, warp, warpSize, type Quad } from '../core/perspective'

/**
 * Canvas side of filters and compression, usable in the page and in a worker
 * (OffscreenCanvas). Decoding with createImageBitmap applies EXIF orientation,
 * so the output is upright.
 *
 * iOS Safari refuses canvases over ~16.7 megapixels; larger images are scaled
 * to fit, which still leaves a US Letter page well above 300 dpi.
 */
export const MAX_CANVAS_PIXELS = 16_000_000

const context = (canvas: OffscreenCanvas, readBack: boolean) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: readBack })
  if (!ctx) throw new Error('No canvas available to process the image.')
  return ctx
}

/** The whole bitmap as RGBA, scaled down only if over the canvas limit. */
const pixelsOf = (bitmap: ImageBitmap) => {
  const cap = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (bitmap.width * bitmap.height)))
  const width = Math.max(1, Math.round(bitmap.width * cap))
  const height = Math.max(1, Math.round(bitmap.height * cap))
  const ctx = context(new OffscreenCanvas(width, height), true)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

const render = async (
  source: Blob,
  size: (natural: { width: number; height: number }) => { width: number; height: number },
  filter: Filter,
  encode: { type: string; quality?: number },
  corners: Quad | null = null,
  /** Only this rectangle of the (uncornered) image. */
  part: Part | null = null,
): Promise<Blob> => {
  const bitmap = await createImageBitmap(source)
  try {
    const crop = part && !corners ? part : { x0: 0, y0: 0, x1: 1, y1: 1 }
    const sx = crop.x0 * bitmap.width
    const sy = crop.y0 * bitmap.height
    const sw = Math.max(1, (crop.x1 - crop.x0) * bitmap.width)
    const sh = Math.max(1, (crop.y1 - crop.y0) * bitmap.height)
    const natural = corners
      ? warpSize(toPixels(corners, bitmap.width, bitmap.height))
      : { width: Math.round(sw), height: Math.round(sh) }
    const wanted = size(natural)
    const cap = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (wanted.width * wanted.height)))
    const width = Math.max(1, Math.round(wanted.width * cap))
    const height = Math.max(1, Math.round(wanted.height * cap))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = context(canvas, filter !== 'original')
    if (corners) {
      // Flatten the photographed sheet straight to the output size.
      const src = pixelsOf(bitmap)
      const flat = warp(
        src.data,
        src.width,
        src.height,
        toPixels(corners, src.width, src.height),
        width,
        height,
      )
      ctx.putImageData(new ImageData(flat, width, height), 0, 0)
    } else {
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
    }
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

/** A preview copy at the source's own scale: cropped and/or filtered. */
export const previewToBlob = (source: Blob, filter: Filter, corners: Quad | null) =>
  render(
    source,
    (natural) => natural,
    filter,
    filter === 'original' ? { type: 'image/jpeg', quality: 0.85 } : filterEncoding(filter),
    corners,
  )

/** An export job: filter, resize to the job's pixels, encode as the job says. */
export const processToBlob = (source: Blob, job: ImageJob) =>
  render(
    source,
    () => ({ width: job.width, height: job.height }),
    job.filter,
    job.format === 'png' ? { type: 'image/png' } : { type: 'image/jpeg', quality: job.quality },
    job.corners,
    job.part,
  )

/**
 * The image a page shows, as it shows it — cropped, then turned and
 * straightened — on white, at most `maxEdge` pixels on its long side. This is
 * what OCR reads, so a photo turned upright is read upright and word boxes are
 * fractions of the displayed image (see core/textLayer.ts).
 */
export const displayedToBlob = async (
  source: Blob,
  corners: Quad | null,
  rotation: number,
  maxEdge: number,
) => {
  // Crop first, at a size whose rotated bounds fit `maxEdge`.
  const content = await createImageBitmap(
    await render(
      source,
      (natural) => {
        const bounds = rotatedBounds(natural.width, natural.height, rotation)
        const scale = Math.min(1, maxEdge / Math.max(bounds.width, bounds.height))
        return {
          width: Math.max(1, Math.round(natural.width * scale)),
          height: Math.max(1, Math.round(natural.height * scale)),
        }
      },
      'original',
      { type: 'image/png' },
      corners,
    ),
  )
  try {
    const bounds = rotatedBounds(content.width, content.height, rotation)
    const width = Math.max(1, Math.round(bounds.width))
    const height = Math.max(1, Math.round(bounds.height))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = context(canvas, false)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.translate(width / 2, height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.drawImage(content, -content.width / 2, -content.height / 2)
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), width, height }
  } finally {
    content.close()
  }
}
