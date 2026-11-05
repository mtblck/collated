import type { Asset, Quality } from './model'
import type { PdfImageInfo } from './pdfImages'
import { PT_PER_IN } from './units'
import { MAX_CANVAS_PIXELS } from './limits'

/** A compression step: the printed resolution images are capped at, and the JPEG quality. */
export interface Compression {
  dpi: number
  quality: number
}

export const QUALITY_PRESETS: Record<
  Exclude<Quality, 'original'>,
  Compression & { label: string; hint: string }
> = {
  high: { dpi: 300, quality: 0.85, label: 'High', hint: '300 dpi — print quality' },
  balanced: {
    dpi: 200,
    quality: 0.8,
    label: 'Balanced',
    hint: '200 dpi — sharp on screen and paper',
  },
  small: { dpi: 150, quality: 0.7, label: 'Small', hint: '150 dpi — email and uploads' },
}

/**
 * Steps tried, in order, when the PDF must fit under a size limit: the chosen
 * quality first, then progressively smaller. Below 150 dpi text starts to
 * blur, so the last two are a last resort, and the result says which was used.
 */
export const FIT_STEPS: readonly Compression[] = [
  QUALITY_PRESETS.high,
  QUALITY_PRESETS.balanced,
  QUALITY_PRESETS.small,
  { dpi: 120, quality: 0.65 },
  { dpi: 96, quality: 0.6 },
]

export const compressionFor = (quality: Quality): Compression | null =>
  quality === 'original' ? null : QUALITY_PRESETS[quality]

/**
 * The pixel size an image is stored at: its own size, or smaller when the
 * printed resolution (image width ÷ drawn width in inches) exceeds the cap.
 * Never larger: upscaling adds bytes and no detail.
 */
export const targetPixels = (
  asset: Pick<Asset, 'width' | 'height'>,
  drawnWidthPt: number,
  compression: Compression | null,
) => {
  if (!compression) return { width: asset.width, height: asset.height }
  const wanted = Math.round((drawnWidthPt / PT_PER_IN) * compression.dpi)
  const scale = Math.min(1, Math.max(1, wanted) / asset.width)
  return {
    width: Math.max(1, Math.round(asset.width * scale)),
    height: Math.max(1, Math.round(asset.height * scale)),
  }
}

/**
 * The size a picture inside a PDF page is shrunk to (#115). Where it sits
 * on its page isn't known without reading the page's drawing, so it's
 * taken to span the page's long side (`drawnLongPt`, as exported): the
 * most it could be, so the cap never takes more than the preset would.
 */
export const pdfImageTarget = (
  image: { width: number; height: number },
  drawnLongPt: number,
  compression: Compression,
) => {
  const long = Math.max(image.width, image.height)
  const wanted = Math.max(1, Math.round((drawnLongPt / PT_PER_IN) * compression.dpi))
  const area = Math.sqrt(MAX_CANVAS_PIXELS / (image.width * image.height))
  const scale = Math.min(1, wanted / long, area)
  return {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
  }
}

export interface FitResult {
  pdf: Uint8Array
  /** The compression the returned PDF used; null if images were kept as they are. */
  compression: Compression | null
  fits: boolean
}

/**
 * Builds with the chosen compression and, if there's a size limit and the
 * file is over it, retries with each smaller step. Returns the first build
 * that fits, or the smallest one tried.
 */
export const buildWithin = async (
  build: (compression: Compression | null) => Promise<Uint8Array>,
  start: Compression | null,
  maxBytes: number | null,
  onAttempt?: (attempt: number) => void,
): Promise<FitResult> => {
  const steps: (Compression | null)[] = [
    start,
    ...FIT_STEPS.filter((s) => !start || s.dpi < start.dpi),
  ]
  let best: FitResult | null = null
  for (const [i, compression] of steps.entries()) {
    onAttempt?.(i + 1)
    const pdf = await build(compression)
    const fits = maxBytes === null || pdf.byteLength <= maxBytes
    if (fits) return { pdf, compression, fits }
    // Only reachable with a limit: without one, the first build fits.
    if (!best || pdf.byteLength < best.pdf.byteLength) best = { pdf, compression, fits }
  }
  if (!best) throw new Error('Nothing was built.')
  return best
}

/**
 * A rough size before exporting. Passthrough content counts its own bytes;
 * re-encoded images scale with their pixel count and a per-quality factor
 * measured on phone photos of documents. It's labelled as an estimate in the
 * UI, and the export reports the real size.
 */
const QUALITY_FACTOR = (q: number) => (q >= 0.85 ? 0.8 : q >= 0.8 ? 0.65 : q >= 0.7 ? 0.5 : 0.4)

/** What a JPEG of a document page takes per pixel at each quality, for pictures stored as pixels. */
const JPEG_BYTES_PER_PIXEL = (q: number) =>
  q >= 0.85 ? 0.35 : q >= 0.8 ? 0.25 : q >= 0.7 ? 0.18 : 0.12

export const estimateBytes = (
  items: {
    asset: Pick<Asset, 'id' | 'bytesId' | 'width' | 'height' | 'format' | 'byteLength'> &
      Partial<Pick<Asset, 'images'>>
    drawnWidthPt: number
  }[],
  compression: Compression | null,
): number => {
  const counted = new Set<string>()
  /** Per PDF file: the longest any of its pages is drawn, and the pictures its used pages draw. */
  const pdfs = new Map<
    string,
    { bytes: number; longPt: number; images: Map<string, PdfImageInfo> }
  >()
  let total = 2_000 // document overhead
  for (const { asset, drawnWidthPt } of items) {
    if (asset.format === 'pdf') {
      const file = pdfs.get(asset.bytesId) ?? {
        bytes: asset.byteLength,
        longPt: 0,
        images: new Map<string, PdfImageInfo>(),
      }
      const long = (drawnWidthPt * Math.max(asset.width, asset.height)) / asset.width
      file.longPt = Math.max(file.longPt, long)
      for (const image of asset.images ?? []) file.images.set(image.key, image)
      pdfs.set(asset.bytesId, file)
      continue
    }
    const key = `${asset.id}:${Math.round(drawnWidthPt)}`
    if (counted.has(key)) continue
    counted.add(key)
    if (!compression) {
      total += asset.byteLength
      continue
    }
    const out = targetPixels(asset, drawnWidthPt, compression)
    const pixelRatio = (out.width * out.height) / (asset.width * asset.height)
    total += Math.min(
      asset.byteLength,
      asset.byteLength * pixelRatio * QUALITY_FACTOR(compression.quality),
    )
  }
  // A PDF counts its whole file, less what shrinking its pictures saves (#115).
  for (const file of pdfs.values()) {
    let saved = 0
    if (compression) {
      for (const image of file.images.values()) {
        const out = pdfImageTarget(image, file.longPt, compression)
        const pixels = out.width * out.height
        const after =
          image.encoding === 'jpeg'
            ? (image.bytes * pixels * QUALITY_FACTOR(compression.quality)) /
              (image.width * image.height)
            : pixels * JPEG_BYTES_PER_PIXEL(compression.quality)
        saved += Math.max(0, image.bytes - after)
      }
    }
    total += Math.max(0, file.bytes - saved)
  }
  return Math.round(total)
}
