// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { PDFDocument, PDFName } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { layoutPage, rotatedBounds } from './geometry'
import type { Page } from './model'
import { OCR_LANGUAGES, type OcrLanguage } from './ocrLanguages'
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
    // The word the standard font can't encode goes in the embedded font
    // (#94). (pdftotext may split words into fragments, so compare the joined text.)
    expect(found.map((w) => w.text).join('')).toBe('InvoiceTotalΩ-not-in-WinAnsi')
    const layout = layoutPage(s, meta, p)
    const { cx, cy, width, height, rotation } = layout.image
    // Words are fractions of the image as displayed: its rotated bounds.
    const box = rotatedBounds(width, height, rotation)
    for (const word of words) {
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

  // Words with every letter beyond A–Z each offered language uses (#79, #94),
  // in both cases: Helvetica or the embedded font must write them all.
  const ACCENTED: Record<OcrLanguage, string> = {
    eng: 'naïve café résumé',
    dan: 'blåbærgrød ÆØÅ',
    nld: 'ruïne één coöperatie',
    fin: 'hääyöaie ÅÄÖ šakki',
    fra: 'élève à cœur où naïf Noël garçon ÉÈÊËÀÂÎÏÔÙÛÜŸÇŒÆ',
    deu: 'Straße Größe Übung Äpfel',
    ita: 'perché città più però così È',
    nor: 'blåbær søt ÆØÅ',
    por: 'coração não pão você avô à ÃÕÂÊÔÇ',
    spa: 'niño ¿qué? ¡olé! pingüino acción ÑÁÉÍÓÚÜ',
    swe: 'räksmörgås ÅÄÖ',
    bul: 'щастие ъгъл ЩЪЮЯ',
    hrv: 'kuća đak čaša šuma žaba ĆĐČŠŽ',
    ces: 'příliš žluťoučký kůň úpěl ďábelské ódy ŘŠČŽÝÁÍÉŮĚŤĎŇ',
    ell: 'Γειά σου κόσμε ψυχή ΆΈΉΊΌΎΏ ϊΐϋΰ',
    hun: 'árvíztűrő tükörfúrógép ŐŰ',
    pol: 'zażółć gęślą jaźń ŁÓDŹ ĄĘŚĆŃŻ',
    ron: 'știință țară mâine încă ȘȚĂÂÎ',
    rus: 'съешь ещё этих ЁЖЩЪЫЭ',
    slk: 'ďateľ kôň ľahký ŕba ÄÔĽĹŔ',
    slv: 'češnja šola žaba ČŠŽ',
    tur: 'ılık şeker dağ İstanbul ŞĞÇÖÜ',
    ukr: 'їжак ґанок єнот ІЇЄҐ',
  }

  it.each(OCR_LANGUAGES)('writes $label words with their accents', async ({ code }) => {
    const sample = ACCENTED[code].split(' ')
    const line: OcrWord[] = sample.map((text, i) => ({
      text,
      x0: 0.05 + i * 0.1,
      y0: 0.4,
      x1: 0.13 + i * 0.1,
      y1: 0.45,
      baseline: 0.45,
    }))
    // Recognisers may give a letter and its accent as two code points.
    line[0] = { ...line[0], text: (line[0]?.text ?? '').normalize('NFD') } as OcrWord
    const bytes = await buildPdf(
      {
        settings: settings({ size: 'letter' }),
        pages: [page('p', 'a')],
        assets: { a: meta },
        text: { p: line },
      },
      { getBytes: () => jpeg },
    )
    const plain = execFileSync('pdftotext', ['-raw', '-', '-'], { input: Buffer.from(bytes) })
      .toString()
      .trim()
    expect(plain.split(/\s+/)).toEqual(sample)
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

  /** The base font names of every font in the PDF, as pdffonts lists them. */
  const fontsOf = (bytes: Uint8Array) =>
    execFileSync('pdffonts', ['-'], { input: Buffer.from(bytes) })
      .toString()
      .split('\n')
      .slice(2)
      .filter(Boolean)
      .map((line) => line.split(/\s+/).slice(0, 2).join(' '))

  const build = (text: OcrWord[], extra: { password?: string; ocrLanguage?: OcrLanguage } = {}) =>
    buildPdf(
      {
        settings: settings({ size: 'letter', ocrLanguage: extra.ocrLanguage ?? 'eng' }),
        pages: [page('p', 'a')],
        assets: { a: meta },
        text: { p: text },
        ...(extra.password ? { password: extra.password } : {}),
      },
      { getBytes: () => jpeg },
    )

  const lineOf = (...texts: string[]): OcrWord[] =>
    texts.map((text, i) => ({
      text,
      x0: 0.05 + i * 0.15,
      y0: 0.4,
      x1: 0.17 + i * 0.15,
      y1: 0.45,
      baseline: 0.45,
    }))

  it('keeps Helvetica alone when every word fits it, so Latin files don’t grow', async () => {
    expect(fontsOf(await build(lineOf('Invoice', 'Total')))).toEqual(['Helvetica Type'])
  })

  it('embeds the glyphless font only when a word needs it, and mixes the two in a line', async () => {
    const bytes = await build(lineOf('Total', 'Ελληνικά', 'zażółć'))
    expect(fontsOf(bytes).sort()).toEqual(['CollatedGlyphless CID', 'Helvetica Type'])
    const plain = execFileSync('pdftotext', ['-raw', '-', '-'], { input: Buffer.from(bytes) })
    expect(plain.toString().trim().split(/\s+/)).toEqual(['Total', 'Ελληνικά', 'zażółć'])
  })

  it('writes the embedded font only as an embedded subset-free CID font with its maps', async () => {
    const bytes = await build(lineOf('Ελληνικά'))
    const line = execFileSync('pdffonts', ['-'], { input: Buffer.from(bytes) })
      .toString()
      .split('\n')[2]
    // name, type (CID TrueType), encoding (Identity-H), emb, sub, uni
    expect(line).toMatch(/^CollatedGlyphless\s+CID TrueType\s+Identity-H\s+yes\s+no\s+yes/)
  })

  it('reads back characters beyond the Basic Multilingual Plane', async () => {
    // 𝐀 (U+1D400) is NFKC-normalised to A, so use a CJK extension B character.
    const bytes = await build(lineOf('𠀋𠀌', 'ok'))
    const plain = execFileSync('pdftotext', ['-raw', '-', '-'], { input: Buffer.from(bytes) })
    expect(plain.toString().trim().split(/\s+/)).toEqual(['𠀋𠀌', 'ok'])
  })

  it('writes the embedded font’s maps before a password encrypts them', async () => {
    const bytes = await build(lineOf('Привет'), { password: 'secret' })
    const plain = execFileSync('pdftotext', ['-upw', 'secret', '-raw', '-', '-'], {
      input: Buffer.from(bytes),
    })
    expect(plain.toString().trim()).toBe('Привет')
  })

  it('tags the document with the language OCR read', async () => {
    const lang = async (bytes: Uint8Array) =>
      (await PDFDocument.load(bytes)).catalog.get(PDFName.of('Lang'))?.toString()
    expect(await lang(await build(lineOf('Привет'), { ocrLanguage: 'rus' }))).toBe('(ru)')
    expect(await lang(await build([], { ocrLanguage: 'rus' }))).toBe('(en)')
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
    expect(Buffer.compare(await render(), await render({ p: lineOf('Ελληνικά', 'Привет') }))).toBe(
      0,
    )
    expect((await PDFDocument.create()).getPageCount()).toBe(0)
  })
})
