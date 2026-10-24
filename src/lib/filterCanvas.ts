import { applyFilter, filterEncoding } from '../core/filters'
import type { Filter } from '../core/model'
import type { FlattenJob, ImageJob } from '../core/pdf'
import { WATERMARK_FONT } from '../core/watermark'
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

/** The bitmap cropped, flattened, resized and filtered, on a canvas of its own. */
const draw = async (
  source: Blob,
  size: (natural: { width: number; height: number }) => { width: number; height: number },
  filter: Filter,
  corners: Quad | null = null,
  /** Only this rectangle of the (uncornered) image. */
  part: Part | null = null,
): Promise<OffscreenCanvas> => {
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
    return canvas
  } finally {
    bitmap.close()
  }
}

const encode = (canvas: OffscreenCanvas, as: { type: string; quality?: number }) =>
  canvas.convertToBlob(as.quality === undefined ? { type: as.type } : as)

const render = async (
  source: Blob,
  size: (natural: { width: number; height: number }) => { width: number; height: number },
  filter: Filter,
  as: { type: string; quality?: number },
  corners: Quad | null = null,
  part: Part | null = null,
): Promise<Blob> => encode(await draw(source, size, filter, corners, part), as)

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
 * A whole page as one JPEG, watermark burned in (#78): white paper, each
 * picture processed as the export would embed it and placed as the layout
 * says (the same turn about its centre the preview's CSS makes), clipped to
 * its cell, then the watermark over everything.
 */
export const flattenToBlob = async (job: FlattenJob) => {
  const want = job.page.width * job.page.height * job.scale * job.scale
  const scale = job.scale * Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / want))
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(job.page.width * scale)),
    Math.max(1, Math.round(job.page.height * scale)),
  )
  const ctx = context(canvas, false)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(canvas.width / job.page.width, canvas.height / job.page.height)
  ctx.imageSmoothingQuality = 'high'
  for (const picture of job.pictures) {
    const blob = new Blob([picture.bytes as Uint8Array<ArrayBuffer>])
    const image = picture.job
      ? await draw(
          blob,
          () => ({ width: picture.job?.width ?? 1, height: picture.job?.height ?? 1 }),
          picture.job.filter,
          picture.job.corners,
          picture.job.part,
        )
      : await createImageBitmap(blob)
    try {
      const { cx, cy, width, height, rotation } = picture.image
      const { x, y, width: w, height: h } = picture.clip
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, w, h)
      ctx.clip()
      ctx.translate(cx, cy)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(image, -width / 2, -height / 2, width, height)
      ctx.restore()
    } finally {
      if (image instanceof ImageBitmap) image.close()
    }
  }
  const { mark } = job
  const { r, g, b } = mark.colour
  ctx.save()
  ctx.globalAlpha = mark.opacity
  ctx.fillStyle = `rgb(${String(Math.round(r * 255))} ${String(Math.round(g * 255))} ${String(Math.round(b * 255))})`
  ctx.font = `${String(mark.size)}px ${WATERMARK_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  // Unkerned, as the PDF's text and the preview set it.
  ctx.fontKerning = 'none'
  ctx.translate(mark.x, mark.baseline)
  ctx.rotate((mark.angle * Math.PI) / 180)
  ctx.fillText(mark.text, 0, 0)
  ctx.restore()
  return encode(canvas, { type: 'image/jpeg', quality: job.quality })
}

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
