import { pageRotation, type Asset, type Page } from '../core/model'
import type { OcrLanguage } from '../core/ocrLanguages'
import type { OcrWord } from '../core/textLayer'
import { assetStore } from '../import/assetStore'
import { displayedToBlob } from './filterCanvas'
import { recognizeWords } from './ocr'

/** OCR reads at up to this many pixels on the long side: ~300 dpi for Letter. */
const OCR_EDGE = 2600

/**
 * A page's words, recognised from its full-resolution image as displayed
 * (cropped, turned, straightened; filters don't matter to OCR), in `language`.
 * Cached per image, crop, rotation and language, so exporting twice doesn't read twice.
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

/** Forgets every page's words (Start over). */
export const forgetPageWords = () => {
  cache.clear()
}

/**
 * `drawn`: a PDF page exported as a drawing (it hides a layer, see
 * export/layered.ts) is read from that drawing, which is upright and uncropped.
 */
export const pageWords = (
  asset: Asset,
  page: Pick<Page, 'corners' | 'turns' | 'angle' | 'redactions'>,
  language: OcrLanguage,
  drawn?: Uint8Array,
): Promise<OcrWord[]> => {
  const rotation = pageRotation(page)
  const corners = drawn ? null : page.corners
  const redactions = page.redactions ?? []
  const key = `${asset.id}:${drawn ? 'drawn' : JSON.stringify(corners)}:${rotation}:${JSON.stringify(redactions)}:${language}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit.words
  }
  const words = (async () => {
    const bytes = drawn ?? assetStore.get(asset.bytesId)
    const { blob, width, height } = await displayedToBlob(
      new Blob([bytes as Uint8Array<ArrayBuffer>]),
      corners,
      rotation,
      OCR_EDGE,
      redactions,
    )
    return recognizeWords(blob, width, height, language)
  })()
  const entry = { bytesId: asset.bytesId, words }
  words.catch(() => {
    if (cache.get(key) === entry) cache.delete(key)
  })
  cache.set(key, entry)
  prune()
  return words
}
