// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { PDFDocument } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { layoutPage, rotatedBounds } from './geometry'
import type { Page } from './model'
import { buildPdf } from './pdf'
import type { OcrWord } from './textLayer'

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const words: OcrWord[] = [
  { text: 'Invoice', x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3, baseline: 0.3 },
  { text: 'Total', x0: 0.55, y0: 0.7, x1: 0.8, y1: 0.78, baseline: 0.78 },
  { text: 'Ω-not-in-WinAnsi', x0: 0.1, y0: 0.85, x1: 0.5, y1: 0.9, baseline: 0.9 },
]

/** Words and their boxes as pdftotext reads them (top-left origin, points). */
const readWords = (bytes: Uint8Array) => {
  const xml = execFileSync('pdftotext', ['-bbox', '-', '-'], {
    input: Buffer.from(bytes),
  }).toString()
  return [
    ...xml.matchAll(
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
    ),
  ].map((m) => ({
    text: m[5],
    cx: (Number(m[1]) + Number(m[3])) / 2,
    cy: (Number(m[2]) + Number(m[4])) / 2,
  }))
}

describe.skipIf(!hasPdftotext)('text layer', () => {
  const jpeg = fixture('quad-landscape.jpg')
  const meta = asset('a', { width: 240, height: 160 })

  it.each<[string, Partial<Page>]>([
    ['upright', {}],
    ['quarter turn', { turns: 1 }],
    ['straightened 8°', { angle: 8 }],
  ])('puts each word over its printed position (%s)', async (_name, transform) => {
    const s = settings({ size: 'letter', margin: 36 })
    const p = page('p', 'a', transform)
    const bytes = await buildPdf(
      { settings: s, pages: [p], assets: { a: meta }, text: { p: words } },
      { getBytes: () => jpeg },
    )
    const found = readWords(bytes)
    // The word the standard font can't encode is skipped, not mangled. (pdftotext
    // may split words into fragments, so compare the joined text.)
    expect(found.map((w) => w.text).join('')).toBe('InvoiceTotal')
    const layout = layoutPage(s, meta, p)
    const { cx, cy, width, height, rotation } = layout.image
    // Words are fractions of the image as displayed: its rotated bounds.
    const box = rotatedBounds(width, height, rotation)
    for (const word of words.slice(0, 2)) {
      const expected = {
        x: cx + ((word.x0 + word.x1) / 2 - 0.5) * box.width,
        y: cy + ((word.y0 + word.y1) / 2 - 0.5) * box.height,
      }
      const got = found.find((w) => w.text === word.text)
      if (!got) continue // split by pdftotext; covered by the joined-text check
      // pdftotext boxes glyphs by the font's ascent/descent, not the ink, so
      // its centre sits ~0.22 of the word's height below the inked box's
      // centre (measured: identical in every orientation). Within 0.3 of the
      // word's height, selection covers the printed word.
      const boxHeight = (word.y1 - word.y0) * box.height
      expect(Math.hypot(got.cx - expected.x, got.cy - expected.y)).toBeLessThan(boxHeight * 0.3)
    }
  })

  it('leaves out words the page hides (cropped off by Fill, or in the margins)', async () => {
    // Filled onto a portrait page, the landscape image loses its left and
    // right sides: words there aren't on the page, so not in its text.
    const s = settings({ size: 'letter', orientation: 'portrait', margin: 36 })
    const p = page('p', 'a', { fit: 'cover' })
    const edges: OcrWord[] = [
      { text: 'LeftEdge', x0: 0.02, y0: 0.5, x1: 0.12, y1: 0.56, baseline: 0.56 },
      { text: 'Middle', x0: 0.45, y0: 0.5, x1: 0.55, y1: 0.56, baseline: 0.56 },
      { text: 'RightEdge', x0: 0.88, y0: 0.5, x1: 0.98, y1: 0.56, baseline: 0.56 },
    ]
    const bytes = await buildPdf(
      { settings: s, pages: [p], assets: { a: meta }, text: { p: edges } },
      {
        getBytes: () => jpeg,
        processImage: () => Promise.resolve(jpeg),
      },
    )
    expect(
      readWords(bytes)
        .map((w) => w.text)
        .join(' '),
    ).toBe('Middle')
  })

  it('keeps words with ligatures, as plain letters', async () => {
    const ligature: OcrWord[] = [
      { text: 'ﬁnal', x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.3, baseline: 0.3 },
    ]
    const bytes = await buildPdf(
      {
        settings: settings({ size: 'letter' }),
        pages: [page('p', 'a')],
        assets: { a: meta },
        text: { p: ligature },
      },
      { getBytes: () => jpeg },
    )
    expect(
      readWords(bytes)
        .map((w) => w.text)
        .join(''),
    ).toBe('final')
  })

  it('separates words with spaces for copying and screen readers', async () => {
    const bytes = await buildPdf(
      {
        settings: settings({ size: 'letter' }),
        pages: [page('p', 'a')],
        assets: { a: meta },
        text: { p: words },
      },
      { getBytes: () => jpeg },
    )
    const plain = execFileSync('pdftotext', ['-raw', '-', '-'], {
      input: Buffer.from(bytes),
    }).toString()
    expect(plain).toMatch(/Invoice\s+Total/)
  })

  it('is invisible: the page renders the same with and without it', async () => {
    const s = settings({ size: 'letter' })
    const p = page('p', 'a')
    const render = async (text?: Record<string, OcrWord[]>) => {
      const bytes = await buildPdf(
        { settings: s, pages: [p], assets: { a: meta }, ...(text ? { text } : {}) },
        { getBytes: () => jpeg },
      )
      return execFileSync('pdftoppm', ['-r', '20', '-gray', '-'], { input: Buffer.from(bytes) })
    }
    expect(Buffer.compare(await render(), await render({ p: words }))).toBe(0)
    expect((await PDFDocument.create()).getPageCount()).toBe(0)
  })
})
