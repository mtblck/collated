import { estimateSkew, type Skew } from '../core/deskew'
import type { Asset } from '../core/model'
import { assetStore } from '../import/assetStore'

/**
 * Reads a page's thumbnail and estimates its skew. The thumbnail (≤ 720 px)
 * holds plenty of line structure and keeps this around 60 ms per page.
 */
export const skewOf = async (asset: Pick<Asset, 'thumbUrl'>): Promise<Skew | null> => {
  const blob = assetStore.thumbBlob(asset.thumbUrl)
  if (!blob) return null
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return estimateSkew(data, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}
