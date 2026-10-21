import { pageRotation, type Asset, type Page } from '../core/model'
import type { OcrWord } from '../core/textLayer'
import { assetStore } from '../import/assetStore'
import { displayedToBlob } from './filterCanvas'
import { recognizeWords } from './ocr'

/** OCR reads at up to this many pixels on the long side: ~300 dpi for Letter. */
const OCR_EDGE = 2600

/**
 * A page's words, recognised from its full-resolution image as displayed
 * (cropped, turned, straightened; filters don't matter to OCR). Cached per
 * image, crop and rotation, so exporting twice doesn't read twice.
 *
 * Bounded: every crop or turn of a page makes a new key, so entries are
 * dropped once their image's bytes are gone, and the least recently used go
 * past MAX_ENTRIES (a few hundred pages' words is a few megabytes at most).
 */
const cache = new Map<string, { bytesId: string; words: Promise<OcrWord[]> }>()
const MAX_ENTRIES = 200

const prune = () => {
  for (const [key, entry] of cache) {
    if (!assetStore.has(entry.bytesId)) cache.delete(key)
  }
  // Maps iterate in insertion order, and hits are re-inserted: oldest first.
  for (const key of cache.keys()) {
    if (cache.size <= MAX_ENTRIES) break
    cache.delete(key)
  }
}

export const pageWords = (
  asset: Asset,
  page: Pick<Page, 'corners' | 'turns' | 'angle'>,
): Promise<OcrWord[]> => {
  const rotation = pageRotation(page)
  const key = `${asset.id}:${JSON.stringify(page.corners)}:${rotation}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit.words
  }
  const words = (async () => {
    const bytes = assetStore.get(asset.bytesId)
    const { blob, width, height } = await displayedToBlob(
      new Blob([bytes as Uint8Array<ArrayBuffer>]),
      page.corners,
      rotation,
      OCR_EDGE,
    )
    return recognizeWords(blob, width, height)
  })()
  const entry = { bytesId: asset.bytesId, words }
  words.catch(() => {
    if (cache.get(key) === entry) cache.delete(key)
  })
  cache.set(key, entry)
  prune()
  return words
}
