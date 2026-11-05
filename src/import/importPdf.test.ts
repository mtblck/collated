// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument, PDFName, PDFString, type PDFRef } from '@cantoo/pdf-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PDF_PAGES } from '../core/limits'
import { unlockedCopy } from '../core/pdfUnlock'
import { ImportError } from './importImage'
import { SKIPPED_LOCKED, importPdf, layeredPage } from './importPdf'

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
    const imported = importPdf(file, bytes, () => crypto.randomUUID(), { onPage })
    await expect(imported).rejects.toBeInstanceOf(ImportError)
    await expect(imported).rejects.toThrow(
      `This PDF has 501 pages; up to ${MAX_PDF_PAGES} can be added from one file.`,
    )
    expect(onPage).not.toHaveBeenCalled()
  }, 20_000)
})

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '../../tests/fixtures', name)))

/**
 * Thumbnails need a canvas, which Node doesn't have: lend importPdf the one
 * pdf.js itself draws with in Node, with the toBlob the page has.
 */
const withCanvas = async () => {
  const { createCanvas } = await import('@napi-rs/canvas')
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = createCanvas(1, 1)
      return Object.assign(canvas, {
        toBlob: (done: (blob: Blob | null) => void, type: 'image/jpeg' | 'image/png') => {
          done(new Blob([new Uint8Array(canvas.toBuffer(type as 'image/png'))], { type }))
        },
      })
    },
  })
}

describe('importPdf: password-protected PDFs (#114)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  const id = () => {
    let n = 0
    return () => `id-${String(++n)}`
  }
  const open = (name: string, options: Parameters<typeof importPdf>[3]) => {
    const bytes = fixture(name)
    return importPdf(new File([bytes], name), bytes, id(), options)
  }

  it('asks again after a wrong password, then keeps an unlocked copy', async () => {
    await withCanvas()
    const answers = ['wrong', 'user-secret']
    const askPassword = vi.fn(() => Promise.resolve(answers.shift() ?? null))
    const unlock = vi.fn(unlockedCopy)
    const imported = await open('quad-password.pdf', { askPassword, unlock })
    expect(askPassword.mock.calls).toEqual([[false], [true]])
    expect(unlock).toHaveBeenCalledOnce()
    expect(unlock.mock.calls[0]?.[1]).toBe('user-secret')
    expect(imported.assets.map((a) => [a.format, a.pdfPage, a.bytesId])).toEqual([
      ['pdf', 0, 'id-1'],
      ['pdf', 1, 'id-1'],
      ['pdf', 2, 'id-1'],
    ])
    // What's kept opens without the password, and nothing holds it.
    const [kept] = imported.files
    expect(imported.files).toHaveLength(1)
    expect((await PDFDocument.load(kept?.bytes ?? new Uint8Array())).getPageCount()).toBe(3)
    expect(JSON.stringify(imported.assets)).not.toContain('user-secret')
  }, 30_000)

  it('skips the file on Cancel', async () => {
    const unlock = vi.fn(unlockedCopy)
    const imported = open('quad-password.pdf', {
      askPassword: () => Promise.resolve(null),
      unlock,
    })
    await expect(imported).rejects.toThrow(SKIPPED_LOCKED)
    expect(unlock).not.toHaveBeenCalled()
  })

  it('refuses it when nothing can ask', async () => {
    await expect(open('quad-password.pdf', {})).rejects.toThrow(
      'This PDF needs a password to open.',
    )
  })

  it('opens an owner-password-only PDF without asking, keeping its bytes', async () => {
    await withCanvas()
    const askPassword = vi.fn(() => Promise.resolve(null))
    const unlock = vi.fn(unlockedCopy)
    const imported = await open('quad-owner-locked.pdf', { askPassword, unlock })
    expect(askPassword).not.toHaveBeenCalled()
    expect(unlock).not.toHaveBeenCalled()
    expect(imported.assets).toHaveLength(3)
    expect(imported.files[0]?.bytes).toEqual(fixture('quad-owner-locked.pdf'))
  }, 30_000)

  it('brings the pages in as drawings when no unlocked copy can be made', async () => {
    await withCanvas()
    const imported = await open('quad-password.pdf', {
      askPassword: () => Promise.resolve('user-secret'),
      unlock: () => Promise.reject(new Error('unsupported encryption')),
    })
    expect(imported.assets.map((a) => [a.format, a.pdfPage])).toEqual([
      ['jpeg', undefined],
      ['jpeg', undefined],
      ['jpeg', undefined],
    ])
    expect(imported.files.map((f) => f.id)).toEqual(imported.assets.map((a) => a.bytesId))
    const first = imported.files[0]?.bytes ?? new Uint8Array()
    expect([first[0], first[1]]).toEqual([0xff, 0xd8])
    // 5 pixels a point (360 dpi) for this 300-point page; 4096 at most.
    expect(Math.max(imported.assets[0]?.width ?? 0, imported.assets[0]?.height ?? 0)).toBe(1500)
  }, 60_000)
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
  it('says yes for hidden content inside a tiling pattern or a Type 3 glyph', async () => {
    expect(
      await hides((d, h) => {
        const pattern = d.context.register(
          d.context.stream('/OC /L BDC 0 0 5 5 re f EMC', {
            Type: 'Pattern',
            PatternType: 1,
            PaintType: 1,
            TilingType: 1,
            BBox: [0, 0, 10, 10],
            XStep: 10,
            YStep: 10,
            Resources: { Properties: { L: h } },
          }),
        )
        content(d, '/Pattern cs /P1 scn 0 0 100 100 re f', { Pattern: { P1: pattern } })
      }),
    ).toBe(true)
    expect(
      await hides((d, h) => {
        const glyph = d.context.register(
          d.context.stream('1000 0 d0 /OC /L BDC 0 0 1000 1000 re f EMC'),
        )
        const font = d.context.register(
          d.context.obj({
            Type: 'Font',
            Subtype: 'Type3',
            FontBBox: [0, 0, 1000, 1000],
            FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
            CharProcs: { a: glyph },
            Encoding: { Type: 'Encoding', Differences: [97, PDFName.of('a')] },
            FirstChar: 97,
            LastChar: 97,
            Widths: [1000],
            Resources: { Properties: { L: h } },
          } as never),
        )
        content(d, 'BT /T3 20 Tf 10 10 Td (a) Tj ET', { Font: { T3: font } })
      }),
    ).toBe(true)
  })
})
