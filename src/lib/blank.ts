import { blankness } from '../core/blank'
import type { Asset, Slot } from '../core/model'
import { assetStore } from '../import/assetStore'
import { previewToBlob } from './filterCanvas'

/**
 * Whether a picture looks blank (#68), from its thumbnail — cropped to the
 * paper first when it has corners, so a photo's table doesn't count. Turns,
 * straightening and filters don't change blankness. Null when there's no
 * thumbnail to read.
 */
export const looksBlank = async (
  asset: Pick<Asset, 'thumbUrl' | 'format'>,
  picture: Pick<Slot, 'corners'>,
): Promise<boolean | null> => {
  const thumb = assetStore.thumbBlob(asset.thumbUrl)
  if (!thumb) return null
  const source =
    picture.corners && asset.format !== 'pdf'
      ? await previewToBlob(thumb, 'original', picture.corners)
      : thumb
  const bitmap = await createImageBitmap(source)
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, bitmap.width, bitmap.height)
    ctx.drawImage(bitmap, 0, 0)
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return blankness(data, bitmap.width, bitmap.height).blank
  } finally {
    bitmap.close()
  }
}
