import {
  INKS,
  SIGNATURE_MAX_EDGE,
  inkBounds,
  inkShare,
  photoToInk,
  type Ink,
} from '../core/signature'

/**
 * Canvas side of signatures (#111): a drawing, typed name or photo made into
 * a transparent PNG trimmed to the ink, at most SIGNATURE_MAX_EDGE on its
 * long side. Runs on the page (OffscreenCanvas), never uploads anything.
 */

export interface SignaturePng {
  png: Uint8Array
  width: number
  height: number
}

/** The self-hosted script face for typed signatures (see index.css). */
export const SIGNATURE_FONT = "'Collated Signature', 'Segoe Script', 'Brush Script MT', cursive"

const context = (canvas: OffscreenCanvas) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('No canvas available to make the signature.')
  return ctx
}

/** Room left round the ink, in output pixels, so a pen's edge isn't shaved. */
const PAD = 4

/**
 * What's drawn on `source`, cut to its ink and scaled to fit the stored
 * size; null if there's no ink.
 */
export const trimToPng = async (
  source: { width: number; height: number } & CanvasImageSource,
): Promise<SignaturePng | null> => {
  const { width, height } = source
  // Read through a canvas of our own, whichever kind drew it.
  const copy = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
  const ctx = context(copy)
  ctx.drawImage(source, 0, 0)
  const bounds = inkBounds(ctx.getImageData(0, 0, width, height).data, width, height, PAD)
  if (!bounds) return null
  const k = Math.min(1, SIGNATURE_MAX_EDGE / Math.max(bounds.width, bounds.height))
  const out = new OffscreenCanvas(
    Math.max(1, Math.round(bounds.width * k)),
    Math.max(1, Math.round(bounds.height * k)),
  )
  const outCtx = context(out)
  outCtx.imageSmoothingQuality = 'high'
  outCtx.drawImage(
    copy,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    out.width,
    out.height,
  )
  const blob = await out.convertToBlob({ type: 'image/png' })
  return { png: new Uint8Array(await blob.arrayBuffer()), width: out.width, height: out.height }
}

/** Size typed signatures are set at before trimming, in pixels. */
const TYPED_SIZE = 160

/** A typed name in the script face. */
export const typedToPng = async (text: string, ink: Ink): Promise<SignaturePng | null> => {
  const name = text.trim()
  if (!name) return null
  const font = `${String(TYPED_SIZE)}px ${SIGNATURE_FONT}`
  // A canvas draws with whatever face is ready; wait for ours.
  await document.fonts.load(font, name).catch(() => [])
  const probe = context(new OffscreenCanvas(1, 1))
  probe.font = font
  const measured = probe.measureText(name).width
  const canvas = new OffscreenCanvas(
    Math.ceil(Math.min(8000, measured + TYPED_SIZE)),
    Math.ceil(TYPED_SIZE * 1.8),
  )
  const ctx = context(canvas)
  ctx.font = font
  ctx.fillStyle = INKS[ink]
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(name, TYPED_SIZE / 2, TYPED_SIZE * 1.2)
  return trimToPng(canvas)
}

/** Photos are read at most this big: plenty for a signature, quick to threshold. */
const PHOTO_EDGE = 1600

/** Thrown when a photo shows no signature (blank paper, or a dark picture). */
export class NoSignatureFound extends Error {
  constructor() {
    super(
      'No signature found in that photo. Sign on plain white paper, fill the picture with it, and try again.',
    )
  }
}

/** A photo of a signature on paper: the paper goes transparent, the pen stays. */
export const photoToPng = async (file: Blob): Promise<SignaturePng> => {
  const bitmap = await createImageBitmap(file)
  try {
    const k = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * k)),
      Math.max(1, Math.round(bitmap.height * k)),
    )
    const ctx = context(canvas)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    photoToInk(image.data, canvas.width, canvas.height)
    const share = inkShare(image.data)
    // A signature is a thin line: a photo mostly "ink" is a dark picture, not paper.
    if (share < 0.0005 || share > 0.4) throw new NoSignatureFound()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.putImageData(image, 0, 0)
    const out = await trimToPng(canvas)
    if (!out) throw new NoSignatureFound()
    return out
  } finally {
    bitmap.close()
  }
}
