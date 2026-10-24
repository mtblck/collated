// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { PDFDocument } from '@cantoo/pdf-lib'
import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { passthrough } from './imageInfo'
import { buildPdf, type BuildInput } from './pdf'
import { NeedsDrawing } from './pdfSanitize'
import { buildSplit } from './splitBuild'

const NOW = new Date('2026-10-24T12:00:00Z')

const jpeg = (name: string) => {
  const bytes = fixture(name)
  const info = passthrough(bytes)
  if (!info.ok) throw new Error(`${name} is not passthrough`)
  return { bytes, meta: asset(name, { width: info.width, height: info.height }) }
}

const land = jpeg('quad-landscape.jpg')
const port = jpeg('quad-portrait.jpg')
const bytes = new Map([
  [land.meta.bytesId, land.bytes],
  [port.meta.bytesId, port.bytes],
])

/** Five pages, told apart by shape: L P P L L. */
const input: BuildInput = {
  // Each page sized to its image, so a page's shape says which it is.
  settings: settings({
    size: 'image',
    pageNumbers: { show: true, position: 'bottom-center', start: 1 },
  }),
  assets: { [land.meta.id]: land.meta, [port.meta.id]: port.meta },
  pages: ['L', 'P', 'P', 'L', 'L'].map((shape, i) =>
    page(`p${String(i)}`, shape === 'L' ? land.meta.id : port.meta.id),
  ),
}

const buildOne = async (one: BuildInput, onProgress: (done: number, total: number) => void) => ({
  pdf: await buildPdf(one, {
    getBytes: (id) => bytes.get(id) ?? new Uint8Array(),
    onProgress,
    now: NOW,
  }),
  compression: null,
  fits: true,
})

const shapes = async (pdf: Uint8Array) => {
  const doc = await PDFDocument.load(pdf)
  return doc.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'L' : 'P'))
}

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const numbers = (pdf: Uint8Array) =>
  execFileSync('pdftotext', ['-layout', '-', '-'], { input: Buffer.from(pdf) })
    .toString()
    .split('\f')
    .map((t) => t.trim())
    .filter(Boolean)

describe('split export (#66)', () => {
  it('zips one PDF per part, each with its own pages in order', async () => {
    const progress = vi.fn()
    const result = await buildSplit(
      input,
      [
        { name: 'x-part-1.pdf', pageIds: ['p0', 'p1'], start: 1 },
        { name: 'x-part-2.pdf', pageIds: ['p2', 'p3', 'p4'], start: 3 },
        // Ranges may overlap and go in any order.
        { name: 'x-part-3.pdf', pageIds: ['p4', 'p0', 'p2'], start: 1 },
      ],
      buildOne,
      progress,
    )
    const files = unzipSync(result.pdf)
    expect(Object.keys(files)).toEqual(['x-part-1.pdf', 'x-part-2.pdf', 'x-part-3.pdf'])
    const [one, two, three] = Object.values(files) as [Uint8Array, Uint8Array, Uint8Array]
    expect(await shapes(one)).toEqual(['L', 'P'])
    expect(await shapes(two)).toEqual(['P', 'L', 'L'])
    expect(await shapes(three)).toEqual(['L', 'L', 'P'])
    // Progress counts pages across every part.
    expect(progress).toHaveBeenLastCalledWith(8, 8)
    expect(progress).toHaveBeenCalledWith(3, 8)
    if (!hasPdftotext) return
    // Page numbers start where each part says: continued, then restarted.
    expect(numbers(one)).toEqual(['1', '2'])
    expect(numbers(two)).toEqual(['3', '4', '5'])
    expect(numbers(three)).toEqual(['1', '2', '3'])
  })

  it('gives every part the same settings, and reports the smallest step any needed', async () => {
    const build = vi.fn((one: BuildInput) =>
      Promise.resolve({
        pdf: new Uint8Array([one.pages.length]),
        compression: one.pages.length > 1 ? { dpi: 120, quality: 0.65 } : null,
        fits: one.pages.length === 1,
      }),
    )
    const locked = { ...input, password: 'pw', text: { p0: [] } }
    const result = await buildSplit(
      locked,
      [
        { name: 'a.pdf', pageIds: ['p0'], start: 1 },
        { name: 'b.pdf', pageIds: ['p1', 'p2'], start: 1 },
      ],
      build,
    )
    for (const [call] of build.mock.calls) {
      expect(call).toMatchObject({ password: 'pw', text: { p0: [] }, assets: input.assets })
    }
    expect(result).toMatchObject({ compression: { dpi: 120 }, fits: false })
  })

  it('asks for every page to draw across all the parts at once', async () => {
    const build = vi.fn((one: BuildInput) =>
      one.pages[0]?.id === 'p1'
        ? Promise.resolve({ pdf: new Uint8Array(), compression: null, fits: true })
        : Promise.reject(new NeedsDrawing([`asset-of-${one.pages[0]?.id ?? ''}`])),
    )
    const run = buildSplit(
      input,
      [
        { name: 'a.pdf', pageIds: ['p0'], start: 1 },
        { name: 'b.pdf', pageIds: ['p1'], start: 1 },
        { name: 'c.pdf', pageIds: ['p2'], start: 1 },
      ],
      build,
    )
    await expect(run).rejects.toMatchObject({ assetIds: ['asset-of-p0', 'asset-of-p2'] })
    expect(build).toHaveBeenCalledTimes(3)
  })
})
