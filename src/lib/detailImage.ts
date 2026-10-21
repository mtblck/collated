import type { Asset, Page } from '../core/model'
import { assetStore } from '../import/assetStore'
import { previewToBlob } from './filterCanvas'

/** The long edge the viewer draws a PDF page at: sharp at 4× zoom on most screens. */
const PDF_EDGE = 3200

/**
 * The page's image at full resolution, for the page viewer: the original,
 * cropped and filtered by the same pixel code as the export (so what you
 * zoom into is what the PDF holds), or a PDF page drawn large. Returns an
 * object URL; the caller revokes it.
 */
export const detailImage = async (
  asset: Pick<Asset, 'bytesId' | 'format' | 'pdfPage'>,
  page: Pick<Page, 'filter' | 'corners'>,
): Promise<string> => {
  const bytes = assetStore.get(asset.bytesId)
  if (asset.format === 'pdf') {
    // pdf.js loads with the PDF import; reuse it rather than bundling twice.
    const { renderPdfPage } = await import('../import/importPdf')
    return URL.createObjectURL(await renderPdfPage(bytes, asset.pdfPage ?? 0, PDF_EDGE))
  }
  const source = new Blob([bytes as Uint8Array<ArrayBuffer>])
  if (page.filter === 'original' && !page.corners) return URL.createObjectURL(source)
  return URL.createObjectURL(await previewToBlob(source, page.filter, page.corners))
}
