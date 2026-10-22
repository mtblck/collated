// @vitest-environment node
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PDFDocument, PDFName, PDFString, type PDFRef } from '@cantoo/pdf-lib'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PDF_PAGES } from '../core/limits'
import { ImportError } from './importImage'
import { importPdf, layeredPage } from './importPdf'

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

describe('layeredPage: does the preview hide anything on a page?', () => {
  type Build = (doc: PDFDocument, hidden: PDFRef, shown: PDFRef) => void
  const pdf = async (build: Build) => {
    const doc = await PDFDocument.create()
    const { context } = doc
    const layer = (name: string) =>
      context.register(context.obj({ Type: 'OCG', Name: PDFString.of(name) }))
    const shown = layer('Shown')
    const hidden = layer('Hidden')
    doc.catalog.set(
      PDFName.of('OCProperties'),
      context.obj({ OCGs: [shown, hidden], D: { OFF: [hidden] } }),
    )
    doc.addPage([200, 200])
    build(doc, hidden, shown)
    return doc.save()
  }
  const page0 = (doc: PDFDocument) => doc.getPage(0).node
  const content = (doc: PDFDocument, text: string, resources: Record<string, unknown>) => {
    page0(doc).set(PDFName.of('Resources'), doc.context.obj(resources as never))
    page0(doc).set(PDFName.of('Contents'), doc.context.register(doc.context.stream(text)))
  }
  const form = (doc: PDFDocument, text: string, extra: Record<string, unknown> = {}) =>
    doc.context.register(
      doc.context.stream(text, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, 100, 100],
        ...extra,
      }),
    )
  const hides = async (build: Build) =>
    (await layeredPage(await pdf(build), 0, { draw: false })).hidden

  it('says no for a page whose layers are all shown, or that uses none', async () => {
    expect(
      await hides((d, _h, s) => {
        content(d, '/OC /L BDC 0 0 9 9 re f EMC', { Properties: { L: s } })
      }),
    ).toBe(false)
    expect(
      await hides((d) => {
        content(d, '0 0 9 9 re f', {})
      }),
    ).toBe(false)
  })

  it('says yes for content, forms, nested forms and annotations in a hidden layer', async () => {
    expect(
      await hides((d, h) => {
        content(d, '/OC /L BDC 0 0 9 9 re f EMC', { Properties: { L: h } })
      }),
    ).toBe(true)
    // Operators run together, as pdf.js reads them.
    expect(
      await hides((d, h) => {
        content(d, '/OC /L BDC /T BMCq Q EMC 0 0 9 9 re f EMC', { Properties: { L: h } })
      }),
    ).toBe(true)
    expect(
      await hides((d, h) => {
        content(d, '/Fm Do', { XObject: { Fm: form(d, '0 0 9 9 re f', { OC: h }) } })
      }),
    ).toBe(true)
    // A form without resources, inheriting its parent form's Properties.
    expect(
      await hides((d, h) => {
        const inner = form(d, '/OC /L BDC 0 0 9 9 re f EMC')
        const outer = form(d, '/In Do', {
          Resources: { XObject: { In: inner }, Properties: { L: h } },
        })
        content(d, '/Out Do', { XObject: { Out: outer } })
      }),
    ).toBe(true)
    // A membership dictionary that's off because its layer is.
    expect(
      await hides((d, h) => {
        const ocmd = d.context.register(d.context.obj({ Type: 'OCMD', OCGs: [h] }))
        content(d, '/OC /M BDC 0 0 9 9 re f EMC', { Properties: { M: ocmd } })
      }),
    ).toBe(true)
    expect(
      await hides((d, h) => {
        const stamp = d.context.register(
          d.context.obj({
            Type: 'Annot',
            Subtype: 'Stamp',
            Rect: [10, 10, 60, 60],
            OC: h,
            AP: { N: form(d, '0 0 9 9 re f') },
          }),
        )
        page0(d).set(PDFName.of('Annots'), d.context.obj([stamp]))
      }),
    ).toBe(true)
  })
})
