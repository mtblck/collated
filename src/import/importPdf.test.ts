// @vitest-environment node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument } from '@cantoo/pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PDF_PAGES } from '../core/limits'
import { ImportError } from './importImage'
import { importPdf } from './importPdf'

// In Node, pdf.js runs its worker in-process by importing workerSrc, so point
// it at the real file rather than Vite's served URL.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({
  default: pathToFileURL(
    createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href,
}))

const pdfWithPages = async (count: number) => {
  const doc = await PDFDocument.create()
  for (let i = 0; i < count; i++) doc.addPage([72, 72])
  return doc.save()
}

describe('importPdf', () => {
  it('refuses a PDF with more pages than the cap, before rendering any', async () => {
    const bytes = await pdfWithPages(MAX_PDF_PAGES + 1)
    const onPage = vi.fn()
    const file = new File([bytes], 'huge.pdf')
    const imported = importPdf(file, bytes, () => crypto.randomUUID(), onPage)
    await expect(imported).rejects.toBeInstanceOf(ImportError)
    await expect(imported).rejects.toThrow(
      `This PDF has 501 pages; up to ${MAX_PDF_PAGES} can be added from one file.`,
    )
    expect(onPage).not.toHaveBeenCalled()
  }, 20_000)
})
