import { applyFilter, filterEncoding } from '../core/filters'
import type { Filter, Redaction } from '../core/model'
import type { ImageJob } from '../core/pdf'
import { rotatedBounds, type Part } from '../core/geometry'
import { redactionShapes } from '../core/redact'
import { toPixels, warp, warpSize, type Point, type Quad } from '../core/perspective'

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

const FULL_PART: Part = { x0: 0, y0: 0, x1: 1, y1: 1 }

/** What a black-out is painted with. */
export const REDACTION_FILL = '#000'

/** Fills each shape (fractions of the canvas) solid black. */
const paint = (
  ctx: OffscreenCanvasRenderingContext2D,
  shapes: readonly Quad[],
  width: number,
  height: number,
) => {
  if (!shapes.length) return
  ctx.save()
  ctx.fillStyle = REDACTION_FILL
  ctx.beginPath()
  for (const shape of shapes) {
    shape.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x * width, p.y * height)
      else ctx.lineTo(p.x * width, p.y * height)
    })
    ctx.closePath()
  }
  ctx.fill('nonzero')
  ctx.restore()
}

/**
 * Whole pixels covering each box, so no partly covered pixel at an edge
 * keeps a trace of what's under it.
 */
const paintBoxes = (
  ctx: OffscreenCanvasRenderingContext2D,
  boxes: readonly Redaction[],
  width: number,
  height: number,
) => {
  ctx.save()
  ctx.fillStyle = REDACTION_FILL
  for (const box of boxes) {
    const x0 = Math.floor(box.x0 * width)
    const y0 = Math.floor(box.y0 * height)
    ctx.fillRect(x0, y0, Math.ceil(box.x1 * width) - x0, Math.ceil(box.y1 * height) - y0)
  }
  ctx.restore()
}

/**
 * The whole bitmap on a canvas (on white), scaled down only if over the
 * canvas limit, with any black-outs painted over the source pixels before
 * anything else reads them.
 */
const sourceOf = (bitmap: ImageBitmap, boxes: readonly Redaction[], readBack: boolean) => {
  const cap = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (bitmap.width * bitmap.height)))
  const width = Math.max(1, Math.round(bitmap.width * cap))
  const height = Math.max(1, Math.round(bitmap.height * cap))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = context(canvas, readBack)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  paintBoxes(ctx, boxes, width, height)
  return { canvas, ctx, width, height }
}

/** The whole bitmap as RGBA (see `sourceOf`). */
const pixelsOf = (bitmap: ImageBitmap, boxes: readonly Redaction[]) => {
  const { ctx, width, height } = sourceOf(bitmap, boxes, true)
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
  /** Black out these rectangles of the upright image first (#77). */
  redactions: readonly Redaction[] = [],
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
      const src = pixelsOf(bitmap, redactions)
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
      if (redactions.length) {
        // Resampled from pixels already painted over, never the originals.
        const src = sourceOf(bitmap, redactions, false)
        const kx = src.width / bitmap.width
        const ky = src.height / bitmap.height
        ctx.drawImage(src.canvas, sx * kx, sy * ky, sw * kx, sh * ky, 0, 0, width, height)
      } else ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
    }
    if (filter !== 'original') {
      const pixels = ctx.getImageData(0, 0, width, height)
      applyFilter(pixels.data, width, height, filter)
      ctx.putImageData(pixels, 0, 0)
    }
    if (redactions.length) {
      // Again over the result, so a box stays solid black: B&W's adaptive
      // threshold would lighten the middle of a big dark area, and resampling
      // softens its edges.
      const crop = part && !corners ? part : FULL_PART
      const inCrop = ({ x, y }: Point) => ({
        x: (x - crop.x0) / (crop.x1 - crop.x0),
        y: (y - crop.y0) / (crop.y1 - crop.y0),
      })
      const shapes = redactionShapes(redactions, corners).map(([a, b, c, d]): Quad => [
        inCrop(a),
        inCrop(b),
        inCrop(c),
        inCrop(d),
      ])
      paint(ctx, shapes, width, height)
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
    job.redactions,
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
  /** Blacked out first, so OCR never reads what they hide (#77). */
  redactions: readonly Redaction[] = [],
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
      null,
      redactions,
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
