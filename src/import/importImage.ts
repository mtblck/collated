import type { Asset } from '../core/model'
import { passthrough, sniff } from '../core/imageInfo'

/** A user-facing reason a file couldn't be added. */
export class ImportError extends Error {
  override name = 'ImportError'
}

export interface Imported {
  asset: Asset
  bytes: Uint8Array
}

const THUMB_EDGE = 720
/**
 * iOS Safari refuses canvases over ~16.7 megapixels. Re-encoded images are
 * scaled down to fit; passthrough JPEGs and PNGs never touch a canvas.
 */
const MAX_CANVAS_PIXELS = 16_000_000

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

const makeCanvas = (width: number, height: number): AnyCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

const toBlob = (canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> =>
  'convertToBlob' in canvas
    ? canvas.convertToBlob({ type, ...(quality === undefined ? {} : { quality }) })
    : new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob)
            else reject(new ImportError('The browser could not encode this image.'))
          },
          type,
          quality,
        )
      })

/** Draws the bitmap at the given size on white (scans have no use for transparency). */
const render = async (
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality?: number,
) => {
  const canvas = makeCanvas(width, height)
  const ctx = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (!ctx) throw new ImportError('This browser has no canvas to process images with.')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  return toBlob(canvas, type, quality)
}

const fit = (width: number, height: number, maxEdge: number, maxPixels = Infinity) => {
  const scale = Math.min(
    1,
    maxEdge / Math.max(width, height),
    Math.sqrt(maxPixels / (width * height)),
  )
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const decode = async (file: Blob, kind: ReturnType<typeof sniff>): Promise<ImageBitmap> => {
  try {
    // Default imageOrientation ('from-image') applies EXIF, so this is upright.
    return await createImageBitmap(file)
  } catch {
    if (kind === 'pdf') throw new ImportError('PDFs can’t be added yet — only images.')
    if (kind === 'heic')
      throw new ImportError('This browser can’t open HEIC photos. Safari can, or export as JPEG.')
    throw new ImportError('Not an image this browser can read.')
  }
}

/**
 * Reads one file into an asset: the bytes that will go into the PDF plus a
 * small upright preview.
 *
 * JPEG and PNG bytes are kept as they are whenever it's safe (see
 * core/imageInfo.ts), so a scan is never recompressed. Everything else the
 * browser can decode — WebP, AVIF, GIF, BMP, HEIC on Safari, mirrored-EXIF or
 * CMYK JPEGs — is re-encoded once.
 */
export const importImage = async (file: File, id: string): Promise<Imported> => {
  const original = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(original)
  const bitmap = await decode(file, kind)
  try {
    const { width, height } = bitmap
    const thumbSize = fit(width, height, THUMB_EDGE)
    const thumb = await render(bitmap, thumbSize.width, thumbSize.height, 'image/jpeg', 0.85)

    const kept = passthrough(original)
    // Belt and braces: if our reading of the header disagrees with the
    // browser's decode, trust the browser and re-encode.
    const agrees = kept.ok && kept.width === width && kept.height === height

    let bytes = original
    let format: Asset['format'] = 'jpeg'
    let storedTurns: Asset['storedTurns'] = 0
    let size = { width, height }
    if (kept.ok && agrees) {
      format = kept.format
      storedTurns = kept.storedTurns
    } else {
      size = fit(width, height, Infinity, MAX_CANVAS_PIXELS)
      format = kind === 'png' ? 'png' : 'jpeg'
      const blob = await render(
        bitmap,
        size.width,
        size.height,
        format === 'png' ? 'image/png' : 'image/jpeg',
        format === 'png' ? undefined : 0.92,
      )
      bytes = new Uint8Array(await blob.arrayBuffer())
    }

    return {
      bytes,
      asset: {
        id,
        name: file.name || 'Pasted image',
        width: size.width,
        height: size.height,
        format,
        storedTurns,
        thumbUrl: URL.createObjectURL(thumb),
        byteLength: bytes.byteLength,
      },
    }
  } finally {
    bitmap.close()
  }
}
