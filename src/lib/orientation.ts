import { OSD_EDGE, type Osd } from '../core/orientation'
import { pageRotation, type Asset, type Page } from '../core/model'
import { assetStore } from '../import/assetStore'
import { displayedToBlob } from './filterCanvas'
import { detectOrientation } from './ocr'

/**
 * Which way up a page's text is, as the page is displayed now (cropped,
 * turned, straightened), so the answer is the turn still to add. PDF pages
 * are drawn first; their thumbnails are too small to read.
 */
export const pageOrientation = async (
  asset: Pick<Asset, 'bytesId' | 'format' | 'pdfPage'>,
  page: Pick<Page, 'corners' | 'turns' | 'angle'>,
): Promise<Osd | null> => {
  const bytes = assetStore.get(asset.bytesId)
  let source: Blob
  if (asset.format === 'pdf') {
    // pdf.js loads with the PDF import; reuse it rather than bundling twice.
    const { renderPdfPage } = await import('../import/importPdf')
    source = await renderPdfPage(bytes, asset.pdfPage ?? 0, OSD_EDGE)
  } else {
    source = new Blob([bytes as Uint8Array<ArrayBuffer>])
  }
  const { blob } = await displayedToBlob(
    source,
    asset.format === 'pdf' ? null : page.corners,
    pageRotation(page),
    OSD_EDGE,
  )
  return detectOrientation(blob)
}
