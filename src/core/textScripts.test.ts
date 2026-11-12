// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { OCR_LANGUAGES, type OcrLanguage } from './ocrLanguages'
import { buildPdf } from './pdf'
import { isRightToLeft, isUnspaced, startsUnspaced, visualOrder } from './scripts'
import { arrangeLine, type OcrWord } from './textLayer'

/** A line's words in reading order, placed right to left or left to right. */
const line = (texts: string[], rtl: boolean, y = 0.4): OcrWord[] =>
  texts.map((text, i) => {
    const x0 = rtl ? 0.85 - i * 0.16 : 0.05 + i * 0.16
    return { text, x0, y0: y, x1: x0 + 0.12, y1: y + 0.05, baseline: y + 0.05 }
  })

describe('visualOrder', () => {
  it.each([
    ['שלום', 'םולש'],
    ['مرحبا', 'ابحرم'],
    // Digits and Latin keep their order, with a separator inside a number.
    ['ש3.5', '3.5ש'],
    ['קובץ.pdf', 'pdf.ץבוק'],
    ['عام٢٠٢٤', '٢٠٢٤ماع'],
    // A mark goes ahead of its letter, as the bidi algorithm reverses it.
    ['\u05e9\u05b8\u05c1\u05dc', '\u05dc\u05c1\u05b8\u05e9'],
    // A mark ending the word is left out: no reader puts it back right.
    ['أهلاً', 'الهأ'],
    ['\u05dc\u05da\u05b8', '\u05da\u05dc'],
    // Brackets aren't mirrored: readers don't mirror them back.
    ['(טוב)', ')בוט('],
  ])('puts %s in page order', (text, visual) => {
    expect(visualOrder(text)).toBe(visual)
  })

  it('leaves left-to-right text alone', () => {
    expect(visualOrder('Invoice 2024')).toBe('Invoice 2024')
    expect(visualOrder('東京')).toBe('東京')
  })
})

describe('arrangeLine', () => {
  it('joins Chinese and Japanese neighbours into one word', () => {
    const words = arrangeLine(line(['東京都', 'に', '住む。', 'Tokyo', '駅'], false))
    expect(words.map((w) => w.text)).toEqual(['東京都に住む。', 'Tokyo', '駅'])
    expect(words[0]).toMatchObject({ x0: 0.05, x1: 0.05 + 0.32 + 0.12 })
  })

  it('keeps far-apart Chinese words apart, as columns or cells', () => {
    const cells = line(['品名', '価格'], false).map((w, i) => ({
      ...w,
      x0: i * 0.5,
      x1: i * 0.5 + 0.1,
    }))
    expect(arrangeLine(cells).map((w) => w.text)).toEqual(['品名', '価格'])
  })

  it('keeps Korean words apart, as Korean has spaces', () => {
    expect(arrangeLine(line(['서울', '특별시'], false)).map((w) => w.text)).toEqual([
      '서울',
      '특별시',
    ])
    expect(isUnspaced('서')).toBe(false)
  })

  it('puts a right-to-left line’s words left to right and marks them', () => {
    const words = arrangeLine(line(['שלום', 'עולם', 'PDF'], true))
    expect(words.map((w) => w.text)).toEqual(['PDF', 'עולם', 'שלום'])
    expect(words.every((w) => w.rtl)).toBe(true)
  })

  it('gives a right-to-left line one height, so pdf.js keeps it one run', () => {
    // The recogniser boxes ink: words with ascenders are taller.
    const words = line(['שלום', 'עולם', 'הבאים'], true).map((w, i) => ({
      ...w,
      y0: w.y0 - i * 0.01,
    }))
    expect(new Set(arrangeLine(words).map((w) => `${w.y0} ${w.y1}`)).size).toBe(1)
  })

  it('joins overlapping boxes, as the recogniser gives Japanese', () => {
    const words: OcrWord[] = [
      { text: '東京', x0: 0.1, x1: 0.6, y0: 0.4, y1: 0.45, baseline: 0.45 },
      { text: '都', x0: 0.2, x1: 0.25, y0: 0.4, y1: 0.45, baseline: 0.45 },
      { text: 'に', x0: 0.25, x1: 0.3, y0: 0.4, y1: 0.45, baseline: 0.45 },
    ]
    expect(arrangeLine(words)).toEqual([
      { text: '東京都に', x0: 0.1, x1: 0.6, y0: 0.4, y1: 0.45, baseline: 0.45 },
    ])
  })

  it('leaves a mostly left-to-right line in reading order', () => {
    const words = arrangeLine(line(['Hello', 'שלום', 'world'], false))
    expect(words.map((w) => w.text)).toEqual(['Hello', 'שלום', 'world'])
    expect(words.some((w) => w.rtl)).toBe(false)
  })
})

const hasPdftotext = (() => {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Text as pdf.js reads it for search and copy: its items, a line apiece. */
const pdfjsText = async (bytes: Uint8Array) => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const content = await (await doc.getPage(1)).getTextContent()
  let text = ''
  for (const item of content.items) {
    if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '')
  }
  await doc.cleanup()
  return text.trim()
}

/** pdftotext's reading-order text, without the bidi embedding marks it adds. */
const pdftotext = (bytes: Uint8Array, ...args: string[]) =>
  execFileSync('pdftotext', [...args, '-', '-'], { input: Buffer.from(bytes) })
    .toString()
    .replace(/[‪-‮]/g, '')
    .trim()

// Letters of each right-to-left language, Arabic and Hebrew marks among them (#139).
const RIGHT_TO_LEFT: Partial<Record<OcrLanguage, string>> = {
  ara: 'مرحبا بالعالم مُحَمَّد ذهب ضوء ظل غيث ة ى',
  heb: 'שָׁלוֹם עולם קובץ חדש ךםןףץ',
  fas: 'سلام دنیا پژوهش گچ کتاب',
  urd: 'ہیلو دنیا اردو زبان ٹھیک ڈر ڑ ے',
}
// Words as the recogniser splits them, and the phrase they make.
const UNSPACED: Partial<Record<OcrLanguage, [string[], string]>> = {
  chi_sim: [['我们', '在', '北京', '工作。'], '我们在北京工作。'],
  chi_tra: [['我們', '在', '臺北', '工作。'], '我們在臺北工作。'],
  jpn: [['東京都', 'に', '住んで', 'います。', 'カタカナ'], '東京都に住んでいます。カタカナ'],
}

describe.skipIf(!hasPdftotext)('text layer in right-to-left and unspaced scripts', () => {
  const jpeg = fixture('quad-landscape.jpg')
  const build = (words: OcrWord[]) =>
    buildPdf(
      {
        settings: settings({ size: 'letter' }),
        pages: [page('p', 'a')],
        assets: { a: asset('a', { width: 240, height: 160 }) },
        text: { p: words },
      },
      { getBytes: () => jpeg },
    )

  it.each(OCR_LANGUAGES)('has a test for $label if its script needs one', ({ code, label }) => {
    const native = /\((.*)\)/.exec(label)?.[1] ?? label
    expect(!!RIGHT_TO_LEFT[code]).toBe(isRightToLeft(native))
    expect(!!UNSPACED[code]).toBe(startsUnspaced(native))
  })

  it.each(OCR_LANGUAGES.filter(({ code }) => RIGHT_TO_LEFT[code]))(
    'reads $label back in reading order',
    async ({ code }) => {
      const words = (RIGHT_TO_LEFT[code] ?? '').normalize('NFKC').split(' ')
      const half = Math.ceil(words.length / 2)
      const expected = [words.slice(0, half).join(' '), words.slice(half).join(' ')]
      const bytes = await build([
        ...arrangeLine(line(words.slice(0, half), true, 0.2)),
        ...arrangeLine(line(words.slice(half), true, 0.6)),
      ])
      expect(pdftotext(bytes).split(/\n+/)).toEqual(expected)
      expect((await pdfjsText(bytes)).split('\n')).toEqual(expected)
    },
  )

  it('keeps numbers and Latin in a right-to-left line in order for pdf.js', async () => {
    const words = ['مرحبا', 'أهلاً', '٢٠٢٤', 'PDF', 'ש3.5', 'קובץ.pdf']
    const bytes = await build(arrangeLine(line(words, true)))
    // The tanwin ending أهلاً is left out (see visualOrder).
    expect(await pdfjsText(bytes)).toBe(words.join(' ').replace('أهلاً', 'أهلا'))
  })

  it('keeps a right-to-left line one run in pdf.js even with wide gaps', async () => {
    // Words 2 em apart would make three runs, read left to right.
    const words = line(['אחד', 'שתיים', 'שלוש'], true).map((w, i) => ({
      ...w,
      x0: 0.75 - i * 0.195,
      x1: 0.87 - i * 0.195,
    }))
    expect(await pdfjsText(await build(arrangeLine(words)))).toBe('אחד שתיים שלוש')
  })

  it.each(OCR_LANGUAGES.filter(({ code }) => UNSPACED[code]))(
    'copies $label phrases without spaces inside',
    async ({ code }) => {
      const [words, phrase] = UNSPACED[code] ?? [[], '']
      const bytes = await build(arrangeLine(line(words, false)))
      expect(pdftotext(bytes, '-raw')).toBe(phrase)
      expect(await pdfjsText(bytes)).toBe(phrase)
    },
  )
})
