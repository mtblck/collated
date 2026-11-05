import type { Asset } from '../core/model'
import { assetStore } from './assetStore'
import { withTiff } from './decodeTiff'
import { assertImportPixels } from './errors'
import { MAX_CANVAS_PIXELS, THUMB_EDGE, fit, render, type Imported } from './importImage'
import type { TiffPage } from './tiffProtocol'

/** A decoded page as something a canvas can draw. */
const bitmapOf = (page: TiffPage) =>
  page.kind === 'png'
    ? createImageBitmap(new Blob([page.bytes], { type: 'image/png' }))
    : createImageBitmap(new ImageData(page.pixels, page.width, page.height))

/**
 * A TIFF (#113) becomes one page per TIFF page, in order, like a PDF.
 * Black-and-white pages are kept as 1-bit PNGs, which the PDF carries as
 * they are (see `embedGreyPng` in core/pdf.ts), so a fax stays small; other
 * pages are encoded once as JPEG, like any format a PDF can't hold. The
 * file's resolution rides along as `Asset.dpi`, so "Match image" sizes the
 * page to the paper that was scanned.
 */
export const importTiff = (
  file: File,
  bytes: Uint8Array,
  newId: () => string,
  onPage?: (done: number, total: number) => void,
): Promise<Imported> =>
  withTiff(bytes, async (count, read) => {
    const base = file.name.replace(/\.tiff?$/i, '') || 'TIFF'
    // Pages of one file share it, for its bookmark (#75).
    const fileId = count > 1 ? newId() : undefined
    const imported: Imported = { assets: [], files: [] }
    for (let index = 0; index < count; index++) {
      const page = await read(index)
      assertImportPixels(page.width, page.height)
      const bitmap = await bitmapOf(page)
      try {
        const thumbSize = fit(page.width, page.height, THUMB_EDGE)
        const thumb = await render(bitmap, thumbSize.width, thumbSize.height, 'image/jpeg', 0.85)
        let stored: Uint8Array = page.kind === 'png' ? page.bytes : new Uint8Array()
        let size = { width: page.width, height: page.height }
        if (page.kind === 'rgba') {
          size = fit(page.width, page.height, Infinity, MAX_CANVAS_PIXELS)
          const blob = await render(bitmap, size.width, size.height, 'image/jpeg', 0.92)
          stored = new Uint8Array(await blob.arrayBuffer())
        }
        const id = newId()
        imported.files.push({ id, bytes: stored })
        imported.assets.push({
          id,
          bytesId: id,
          name: count === 1 ? file.name || 'TIFF' : `${base} · p${String(index + 1)}`,
          width: size.width,
          height: size.height,
          format: page.kind === 'png' ? 'png' : 'jpeg',
          storedTurns: 0,
          thumbUrl: assetStore.thumbUrl(thumb),
          byteLength: stored.byteLength,
          capturedAt: file.lastModified,
          // A page scaled down to fit a canvas has proportionally fewer dots per inch.
          ...(page.dpi ? { dpi: (page.dpi * size.width) / page.width } : {}),
          ...(fileId ? { fileId } : {}),
        } satisfies Asset)
      } finally {
        bitmap.close()
      }
      onPage?.(index + 1, count)
    }
    return imported
  })
