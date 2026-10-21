import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_PDF_PAGES } from '../core/limits'
import type { Asset, QuarterTurns } from '../core/model'
import { assetStore } from './assetStore'
import { ImportError, THUMB_EDGE, fit, type Imported } from './importImage'

/**
 * pdf.js loads only when a PDF is dropped (~150 KB gzipped, plus its worker).
 * The legacy build, because pdf.js 6's modern build calls brand-new built-ins
 * (Map.prototype.getOrInsertComputed) that current Chromium and Safari
 * releases don't all have; the legacy build polyfills them.
 */
const loadPdfJs = async () => {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

const toTurns = (degrees: number): QuarterTurns =>
  (((Math.round(degrees / 90) % 4) + 4) % 4) as QuarterTurns

const renderThumb = async (page: PDFPageProxy, width: number, height: number): Promise<Blob> => {
  const size = fit(width, height, THUMB_EDGE)
  const viewport = page.getViewport({ scale: size.width / width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  // White behind transparent pages, as they print.
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new ImportError('The browser could not draw this PDF page.'))
      },
      'image/jpeg',
      0.85,
    )
  })
}

/**
 * One page drawn larger (long edge `maxEdge` px), for the page viewer. pdf.js
 * is already loaded if the PDF is in the document.
 */
export const renderPdfPage = async (bytes: Uint8Array, pageIndex: number, maxEdge: number) => {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    useSystemFonts: true,
  })
  const pdf = await task.promise
  try {
    const page = await pdf.getPage(pageIndex + 1)
    const upright = page.getViewport({ scale: 1 })
    const size = fit(upright.width * 4, upright.height * 4, maxEdge)
    const viewport = page.getViewport({ scale: size.width / upright.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport, background: '#ffffff' }).promise
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('The browser could not draw this PDF page.'))
      }, 'image/png')
    })
  } finally {
    void task.destroy()
  }
}

/**
 * Reads a PDF into one asset per page. All pages share the file's bytes (kept
 * as they are: the export embeds the pages as vectors, so nothing is
 * rasterised). pdf.js renders the thumbnails with each page's /Rotate applied,
 * and the export applies the same rotation through `storedTurns`.
 */
export const importPdf = async (
  file: File,
  bytes: Uint8Array,
  newId: () => string,
  onPage?: (done: number, total: number) => void,
): Promise<Imported> => {
  const pdfjs = await loadPdfJs()
  const bytesId = newId()
  // pdf.js transfers (detaches) the buffer it's given, so hand it a copy.
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    useSystemFonts: true,
  })
  task.onPassword = () => {
    void task.destroy()
  }
  let pdf
  try {
    pdf = await task.promise
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'PasswordException' || task.destroyed) {
      throw new ImportError('This PDF needs a password to open. Remove the password and try again.')
    }
    throw new ImportError('This PDF couldn’t be read; it may be damaged.')
  }

  const assets: Asset[] = []
  try {
    // Checked before rendering anything: each page costs a thumbnail.
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ImportError(
        `This PDF has ${pdf.numPages.toLocaleString('en-US')} pages; up to ${MAX_PDF_PAGES} can be added from one file. Split it and add the parts.`,
      )
    }
    const base = file.name.replace(/\.pdf$/i, '') || 'PDF'
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1)
      // getViewport applies /Rotate and the crop box: the page as it shows.
      const upright = page.getViewport({ scale: 1 })
      const thumb = await renderThumb(page, upright.width, upright.height)
      assets.push({
        id: newId(),
        bytesId,
        pdfPage: index,
        name: pdf.numPages === 1 ? file.name : `${base} · p${index + 1}`,
        width: upright.width,
        height: upright.height,
        format: 'pdf',
        storedTurns: toTurns(page.rotate),
        thumbUrl: assetStore.thumbUrl(thumb),
        byteLength: bytes.byteLength,
      })
      page.cleanup()
      onPage?.(index + 1, pdf.numPages)
    }
  } finally {
    await task.destroy()
  }
  if (assets.length === 0) throw new ImportError('This PDF has no pages.')
  return { assets, files: [{ id: bytesId, bytes }] }
}
