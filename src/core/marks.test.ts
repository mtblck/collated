import { describe, expect, it } from 'vitest'
import { asset, doc, page } from '../../tests/helpers'
import {
  MARK_ANGLE_LIMIT,
  MARK_MIN_WIDTH,
  assetIdsOf,
  cleanMark,
  markBox,
  newSignature,
  placedMarks,
  usedAssetIds,
} from './marks'
import type { Mark } from './model'
import { docReducer } from './reducer'

const mark = (patch: Partial<Mark> = {}): Mark => ({
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
