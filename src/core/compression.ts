import type { Asset, Quality } from './model'
import { PT_PER_IN } from './units'

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

export const estimateBytes = (
  items: {
    asset: Pick<Asset, 'id' | 'bytesId' | 'width' | 'height' | 'format' | 'byteLength'>
    drawnWidthPt: number
  }[],
  compression: Compression | null,
): number => {
  const counted = new Set<string>()
  let total = 2_000 // document overhead
  for (const { asset, drawnWidthPt } of items) {
    if (asset.format === 'pdf') {
      if (!counted.has(asset.bytesId)) total += asset.byteLength
      counted.add(asset.bytesId)
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
  return Math.round(total)
}
