import { describe, expect, it } from 'vitest'
import { asset, doc, page } from '../../tests/helpers'
import {
  MARK_ANGLE_LIMIT,
  MARK_MIN_WIDTH,
  STAMP_MIN_WIDTH,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_SIZE,
  assetIdsOf,
  cleanMark,
  markBox,
  markReady,
  markTextProblems,
  newSignature,
  newStamp,
  newText,
  placedMarks,
  sizeOf,
  todayText,
  usedAssetIds,
  withSize,
} from './marks'
import type { ImageMark, TextMark } from './model'
import { textWidth } from './watermark'
import { docReducer } from './reducer'

const mark = (patch: Partial<ImageMark> = {}): ImageMark => ({
  id: 'm',
  kind: 'signature',
  assetId: 'sig',
  x: 0.5,
  y: 0.5,
  angle: 0,
  width: 0.25,
  ...patch,
})
const signature = asset('sig', { format: 'png', width: 300, height: 100 })

describe('marks (#111)', () => {
  it('keeps a mark on its page, within its size and turn', () => {
    expect(cleanMark(mark({ x: -1, y: 2, angle: 90, width: 0 }))).toMatchObject({
      x: 0,
      y: 1,
      angle: MARK_ANGLE_LIMIT,
      width: MARK_MIN_WIDTH,
    })
    expect(cleanMark(mark({ x: Number.NaN, width: 5 }))).toMatchObject({ x: 0, width: 1 })
  })

  it('sizes a picture mark by the page’s width and the picture’s shape', () => {
    const box = markBox(
      mark({ x: 0.25, y: 0.75, angle: -5 }),
      { width: 600, height: 800 },
      signature,
    )
    expect(box).toEqual({ cx: 150, cy: 600, width: 150, height: 50, rotation: -5 })
  })

  it('starts a signature about 160 pt wide, never more than half the page', () => {
    expect(newSignature('n', 'sig', { width: 612 }).width).toBeCloseTo(160 / 612)
    expect(newSignature('n', 'sig', { width: 200 }).width).toBe(0.5)
    expect(newSignature('n', 'sig', { width: 612 })).toMatchObject({ x: 0.5, y: 0.75, angle: 0 })
  })

  it('counts a signature’s picture as used, and leaves out marks with none', () => {
    const p = page('p', 'a', { marks: [mark(), mark({ id: 'gone', assetId: 'missing' })] })
    expect(assetIdsOf(p)).toEqual(['a', 'sig', 'missing'])
    expect([...usedAssetIds({ pages: [p] })]).toEqual(['a', 'sig', 'missing'])
    expect(
      placedMarks(p, { width: 100, height: 100 }, { sig: signature }).map((m) => m.id),
    ).toEqual(['m'])
  })

  describe('in the document', () => {
    const signedDoc = () =>
      docReducer(doc(2), {
        type: 'setMarks',
        id: 'p0',
        marks: [mark({ x: 3 })],
        assets: [signature],
      })

    it('puts marks on one page, cleaned, adding their pictures', () => {
      const state = signedDoc()
      expect(state.assets.sig).toEqual(signature)
      expect(state.pages[0]?.marks).toEqual([mark({ x: 1 })])
      expect(state.pages[1]?.marks).toBeUndefined()
    })

    it('makes no undo step when nothing changed', () => {
      const state = signedDoc()
      const marks = state.pages[0]?.marks ?? []
      expect(docReducer(state, { type: 'setMarks', id: 'p0', marks: [...marks] })).toBe(state)
      expect(docReducer(state, { type: 'setMarks', id: 'p1', marks: [] })).toBe(state)
      expect(
        docReducer(state, { type: 'setMarks', id: 'p0', marks: [...marks], assets: [signature] }),
      ).toBe(state)
    })

    it('drops marks whose picture the document lacks, and none removes them', () => {
      const lacking = docReducer(doc(1), { type: 'setMarks', id: 'p0', marks: [mark()] })
      expect(lacking.pages[0]).not.toHaveProperty('marks')
      const cleared = docReducer(signedDoc(), { type: 'setMarks', id: 'p0', marks: [] })
      expect(cleared.pages[0]).not.toHaveProperty('marks')
      // The picture stays, so undo has it.
      expect(cleared.assets.sig).toBeDefined()
    })

    it('keeps them through reset and duplicate; combining drops them', () => {
      let state = docReducer(signedDoc(), { type: 'resetPage', id: 'p0' })
      expect(state.pages[0]?.marks).toHaveLength(1)
      state = docReducer(state, { type: 'duplicatePage', id: 'p0', newId: 'copy' })
      expect(state.pages[1]?.marks).toHaveLength(1)
      state = docReducer(state, {
        type: 'combinePages',
        ids: ['p0', 'p1'],
        kind: 'two',
        newIds: ['s'],
      })
      expect(state.pages[0]?.marks).toBeUndefined()
    })
  })
})

describe('text and stamps (#112)', () => {
  const page612 = { width: 612, height: 792 }
  const text = (patch: Partial<TextMark> = {}): TextMark => ({
    ...newText('t', page612, { x: 0.5, y: 0.5 }, 'Name'),
    ...patch,
  })

  it('starts text at 12 pt and stamps at 18 pt, in black', () => {
    expect(text().size * 612).toBeCloseTo(12)
    expect(text().colour).toBe('#000000')
    const stamp = newStamp('s', 'tick', page612, { x: 0.2, y: 0.3 })
    expect(stamp).toMatchObject({ kind: 'tick', x: 0.2, y: 0.3, angle: 0 })
    expect(stamp.width * 612).toBeCloseTo(18)
  })

  it('boxes text round its lines, a line height apart', () => {
    const m = text({ text: 'Avery Quinn\nFlat 2' })
    const box = markBox(m, page612)
    const size = m.size * 612
    expect(box?.width).toBeCloseTo(textWidth('Avery Quinn', size))
    expect(box?.height).toBeCloseTo(2 * size * TEXT_LINE_HEIGHT)
    // A square stamp, however tall the page.
    const stamp = newStamp('s', 'cross', page612, { x: 0.5, y: 0.5 })
    expect(markBox(stamp, page612)).toMatchObject({ width: 18, height: 18 })
  })

  it('sizes text by its font size and stamps by their width', () => {
    expect(sizeOf(withSize(text(), 0.05))).toBe(0.05)
    expect(cleanMark(withSize(text(), 1))).toMatchObject({ size: TEXT_MAX_SIZE })
    const stamp = newStamp('s', 'tick', page612, { x: 0.5, y: 0.5 })
    expect(cleanMark(withSize(stamp, 0))).toMatchObject({ width: STAMP_MIN_WIDTH })
  })

  it('cleans a colour and line endings, and caps the length', () => {
    const m = cleanMark(text({ colour: 'red', text: `a\r\nb${'x'.repeat(600)}` }))
    expect(m.colour).toBe('#000000')
    expect(m.text.startsWith('a\nb')).toBe(true)
    expect(m.text).toHaveLength(500)
  })

  it('finds characters the font can’t write, but not line breaks', () => {
    // Accents typed as a letter and a combining mark are written as one letter.
    expect(cleanMark(text({ text: 'Rene\u0301' })).text).toBe('René')
    expect(markTextProblems(text({ text: 'Zoë\nCafé €5' }))).toEqual([])
    expect(markTextProblems(text({ text: 'Ωmega 日本' }))).toEqual(['Ω', '日', '本'])
  })

  it('drops empty text, and keeps stamps with no picture', () => {
    expect(markReady(text({ text: '  ' }), {})).toBe(false)
    expect(markReady(text(), {})).toBe(true)
    expect(markReady(newStamp('s', 'tick', page612, { x: 0, y: 0 }), {})).toBe(true)
    const p = page('p', 'a', { marks: [text()] })
    expect(assetIdsOf(p)).toEqual(['a'])
    const state = docReducer(doc(1), {
      type: 'setMarks',
      id: 'p0',
      marks: [text({ text: '' }), text({ id: 'u', text: 'Yes' })],
    })
    expect(state.pages[0]?.marks?.map((m) => m.id)).toEqual(['u'])
  })

  it('draws text and stamps in the preview without pictures', () => {
    const p = page('p', 'a', { marks: [text(), newStamp('s', 'tick', page612, { x: 0, y: 0 })] })
    expect(placedMarks(p, page612, {}).map((m) => m.kind)).toEqual(['text', 'stamp'])
  })

  it('writes today’s date in the font’s letters', () => {
    const day = new Date(2026, 10, 5)
    expect(todayText(day, 'en-GB')).toBe('5 Nov 2026')
    expect(todayText(day, 'en-US')).toBe('Nov 5, 2026')
    // Russian needs letters the font hasn't: the ISO date instead.
    expect(todayText(day, 'ru-RU')).toBe('2026-11-05')
  })
})
