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
 */
const cache = new Map<string, Promise<OcrWord[]>>()

export const pageWords = (
  asset: Asset,
  page: Pick<Page, 'corners' | 'turns' | 'angle'>,
): Promise<OcrWord[]> => {
  const rotation = pageRotation(page)
  const key = `${asset.id}:${JSON.stringify(page.corners)}:${rotation}`
  let words = cache.get(key)
  if (!words) {
    words = (async () => {
      const bytes = assetStore.get(asset.bytesId)
      const { blob, width, height } = await displayedToBlob(
        new Blob([bytes as Uint8Array<ArrayBuffer>]),
        page.corners,
        rotation,
        OCR_EDGE,
      )
      return recognizeWords(blob, width, height)
    })()
    words.catch(() => cache.delete(key))
    cache.set(key, words)
  }
  return words
}
