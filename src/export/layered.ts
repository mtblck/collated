import type { Asset } from '../core/model'
import { assetStore } from '../import/assetStore'

/**
 * PDF pages that hide something (a layer that's off by default) are
 * exported as the preview draws them, not as vectors: pulling hidden content
 * out of a page's drawing instructions without changing what's shown has too
 * many edge cases to trust with private content. Drawn once per page and
 * kept until Start over.
 */
const cache = new Map<string, Promise<Uint8Array | null>>()

export const layeredImage = (asset: Pick<Asset, 'bytesId' | 'pdfPage'>) => {
  const key = `${asset.bytesId}:${String(asset.pdfPage ?? 0)}`
  let drawn = cache.get(key)
  if (!drawn) {
    drawn = import('../import/importPdf').then(({ layeredPage }) =>
      layeredPage(assetStore.get(asset.bytesId), asset.pdfPage ?? 0).then((r) => r.jpeg),
    )
    // A failure shouldn't stick: the next export tries again.
    drawn.catch(() => cache.delete(key))
    cache.set(key, drawn)
  }
  return drawn
}

/** Forgets every drawn page (Start over). */
export const forgetLayered = () => {
  cache.clear()
}
