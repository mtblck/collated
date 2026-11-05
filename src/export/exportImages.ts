import type { Zippable } from 'fflate'
import { IMAGE_TYPES, pagePixels, type ImageFormat } from '../core/imageExport'
import { MAX_CANVAS_PIXELS } from '../core/limits'
import { toBlob } from '../import/importImage'

export interface ImageOptions {
  format: ImageFormat
  dpi: number
  /** JPEG quality, 0–1; PNG ignores it. */
  quality: number
}

/**
 * Each page of an exported PDF as an image (#117). Drawing the finished PDF,
 * rather than each picture again, gives exactly what the PDF shows: crop,
 * filters, black-outs, watermark, page numbers and combined pages, with no
 * second copy of the placement logic. One page at a time, its canvas freed
 * before the next, so a phone holds one page's pixels at once.
 */
export const pdfToImages = async (
  pdf: Blob,
  options: ImageOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> => {
  const { loadPdfJs } = await import('../import/importPdf')
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    data: new Uint8Array(await pdf.arrayBuffer()),
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    useSystemFonts: true,
  })
  const doc = await task.promise
  try {
    const images: Blob[] = []
    for (let n = 1; n <= doc.numPages; n += 1) {
      onProgress?.(n - 1, doc.numPages)
      const page = await doc.getPage(n)
      const upright = page.getViewport({ scale: 1 })
      const size = pagePixels(upright.width, upright.height, options.dpi, MAX_CANVAS_PIXELS)
      const viewport = page.getViewport({ scale: size.scale })
      const canvas = document.createElement('canvas')
      canvas.width = size.width
      canvas.height = size.height
      try {
        // White paper, as it prints; PNG would otherwise keep a transparent page.
        await page.render({ canvas, viewport, background: '#ffffff' }).promise
        images.push(await toBlob(canvas, IMAGE_TYPES[options.format].mime, options.quality))
      } finally {
        // Safari caps what all canvases together may hold.
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
    }
    onProgress?.(doc.numPages, doc.numPages)
    return images
  } finally {
    void task.destroy()
  }
}

/** Several images in one ZIP, stored: JPEG and PNG are compressed already. */
export const zipImages = async (files: readonly { name: string; blob: Blob }[]) => {
  const { zipSync } = await import('fflate')
  const entries: Zippable = {}
  for (const { name, blob } of files) {
    entries[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
  }
  const zip = zipSync(entries)
  return new Blob([zip], { type: 'application/zip' })
}
