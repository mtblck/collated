// @vitest-environment node
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Watermark } from './model'
import {
  NO_WATERMARK,
  colourOf,
  textWidth,
  unsupportedCharacters,
  watermarkMark,
  watermarks,
} from './watermark'

const letter = { width: 612, height: 792 }
const on: Watermark = { ...NO_WATERMARK, show: true, text: 'Copy for Acme Bank only' }
const noNumbers = { show: false, position: 'bottom-center' as const, start: 1 }

describe('textWidth', () => {
  it('measures as the PDF’s Helvetica draws it (unkerned)', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    // pdf-lib's own measure adds kerning that drawText never applies.
    const drawn = (text: string, size: number) => {
      let sum = 0
      for (const ch of text) sum += font.widthOfTextAtSize(ch, size)
      return sum
    }
    for (const text of [
      'Copy for Acme Bank only',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789',
      '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
      'Café · 24 Oct 2026 – “Größe” ©®°×£§ ß Æ æ Ø ø Œ œ € … • ’',
      'Ünïcödé àçcéñts',
    ]) {
      expect(textWidth(text, 20)).toBeCloseTo(drawn(text, 20), 6)
    }
    for (const code of font.getCharacterSet()) {
      const ch = String.fromCodePoint(code)
      expect(textWidth(ch, 1000), ch).toBeCloseTo(font.widthOfTextAtSize(ch, 1000), 6)
    }
  })
})

describe('unsupportedCharacters', () => {
  it('agrees with the standard font’s character set', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const set = new Set(font.getCharacterSet())
    for (let code = 32; code < 0x2200; code++) {
      const ch = String.fromCodePoint(code)
      // Combining marks and the like change under NFC; the rest stand alone.
      if (ch.normalize('NFC') !== ch) continue
      expect(unsupportedCharacters(ch).length === 0, `U+${code.toString(16)}`).toBe(set.has(code))
    }
  })

  it('lists each missing character once', () => {
    expect(unsupportedCharacters('Łódź Łódź 東京')).toEqual(['Ł', 'ź', '東', '京'])
    expect(unsupportedCharacters('Copy for Zoë – 24 Oct')).toEqual([])
  })
})

describe('colourOf', () => {
  it('reads #rrggbb, else mid grey', () => {
    expect(colourOf('#ff8000')).toEqual({ r: 1, g: 128 / 255, b: 0 })
    expect(colourOf('red')).toEqual({ r: 0.5, g: 0.5, b: 0.5 })
  })
})

describe('watermarkMark', () => {
  it('is absent when off, empty or not on this page', () => {
    expect(watermarkMark(NO_WATERMARK, 'p', letter, 0, noNumbers)).toBeNull()
    expect(watermarkMark({ ...on, text: '  ' }, 'p', letter, 0, noNumbers)).toBeNull()
    expect(watermarkMark({ ...on, pageIds: ['q'] }, 'p', letter, 0, noNumbers)).toBeNull()
    expect(watermarks({ ...on, pageIds: ['q'] }, 'q')).toBe(true)
  })

  it('runs corner to corner with its capitals centred on the page', () => {
    const mark = watermarkMark(on, 'p', letter, 0, noNumbers)
    if (!mark) throw new Error('no mark')
    expect(mark.angle).toBeCloseTo((-Math.atan2(792, 612) * 180) / Math.PI, 6)
    expect(mark.size).toBeCloseTo(612 * 0.09, 6)
    // Half a cap height up from the baseline, along the text's own up.
    const r = (mark.angle * Math.PI) / 180
    const up = (0.718 * mark.size) / 2
    expect(mark.x + Math.sin(r) * up).toBeCloseTo(306, 6)
    expect(mark.baseline - Math.cos(r) * up).toBeCloseTo(396, 6)
    expect(mark.text).toBe('Copy for Acme Bank only')
  })

  it('shrinks text too long for the diagonal', () => {
    const long = { ...on, size: 'large' as const, text: 'Copy for Acme Bank only — '.repeat(3) }
    const mark = watermarkMark(long, 'p', letter, 0, noNumbers)
    if (!mark) throw new Error('no mark')
    expect(textWidth(mark.text, mark.size)).toBeCloseTo(Math.hypot(612, 792) * 0.8, 6)
  })

  it('sits in the bottom band along the foot, a line above bottom page numbers', () => {
    const foot = { ...on, position: 'footer' as const }
    expect(watermarkMark(foot, 'p', letter, 72, noNumbers)).toMatchObject({
      x: 306,
      baseline: 792 - 36 + 3,
      size: 9,
      angle: 0,
    })
    const numbers = { ...noNumbers, show: true }
    expect(watermarkMark(foot, 'p', letter, 72, numbers)?.baseline).toBeCloseTo(792 - 36 + 3 - 14.4)
    expect(
      watermarkMark(foot, 'p', letter, 72, { ...numbers, position: 'top-right' })?.baseline,
    ).toBe(792 - 36 + 3)
  })

  it('keeps opacity within range', () => {
    expect(watermarkMark({ ...on, opacity: 0 }, 'p', letter, 0, noNumbers)?.opacity).toBe(0.1)
    expect(watermarkMark({ ...on, opacity: 3 }, 'p', letter, 0, noNumbers)?.opacity).toBe(1)
  })
})
