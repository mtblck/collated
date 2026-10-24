import { describe, expect, it } from 'vitest'
import { asset, doc, page, settings } from '../../tests/helpers'
import { pageName } from '../components/format'
import { describeChange } from './describeChange'
import { layoutSheet } from './geometry'
import { blankPage, picturesOf, sizeModel } from './model'
import { docReducer } from './reducer'

const ids = (state: { pages: { id: string }[] }) => state.pages.map((p) => p.id)

describe('blank pages (#80)', () => {
  it('inserts after the given page, or at the end, with no picture', () => {
    const start = doc(3)
    const after = docReducer(start, { type: 'insertBlank', id: 'b', after: 'p0' })
    expect(ids(after)).toEqual(['p0', 'b', 'p1', 'p2'])
    expect(ids(docReducer(start, { type: 'insertBlank', id: 'b' }))).toEqual([
      'p0',
      'p1',
      'p2',
      'b',
    ])
    // A page that has gone since: at the end.
    expect(ids(docReducer(start, { type: 'insertBlank', id: 'b', after: 'gone' })).at(-1)).toBe('b')
    const blank = after.pages[1]
    if (!blank) throw new Error('blank')
    expect(blank.blank).toBe(true)
    expect(picturesOf(blank)).toEqual([])
    expect(after.assets).toBe(start.assets)
  })

  it('is left out of combining and sorting, and keeps its turn on Apply to all', () => {
    const start = docReducer(doc(3), { type: 'insertBlank', id: 'b', after: 'p0' })
    const combined = docReducer(start, {
      type: 'combinePages',
      ids: ['p0', 'b', 'p1'],
      kind: 'two',
      newIds: ['s'],
    })
    expect(ids(combined)).toEqual(['s', 'b', 'p2'])
    expect(combined.pages[0]?.sheet?.slots.map((s) => s.assetId)).toEqual(['a0', 'a1'])

    for (const [i, name] of ['c.jpg', 'b.jpg', 'a.jpg'].entries()) {
      start.assets[`a${String(i)}`] = asset(`a${String(i)}`, { name })
    }
    expect(ids(docReducer(start, { type: 'sortPages', by: 'name' }))).toEqual([
      'p2',
      'b',
      'p1',
      'p0',
    ])

    const turned = docReducer(start, { type: 'rotatePage', id: 'p0', by: 1 })
    const applied = docReducer(turned, { type: 'applyToAll', id: 'p0' })
    expect(applied.pages.map((p) => p.turns)).toEqual([1, 0, 1, 1])
  })

  it('is sized by page setup: portrait unless turned or set landscape', () => {
    const blank = blankPage('b')
    const a4 = settings({ size: 'a4', margin: 36 })
    const { page: size, content, pictures } = layoutSheet(a4, {}, blank)
    expect(size.width).toBeCloseTo(595.28, 1)
    expect(size.height).toBeCloseTo(841.89, 1)
    expect(content.x).toBe(36)
    expect(pictures).toEqual([])
    expect(layoutSheet(a4, {}, { ...blank, turns: 1 }).page.width).toBeCloseTo(841.89, 1)
    expect(
      layoutSheet(settings({ size: 'letter', orientation: 'landscape' }), {}, blank).page,
    ).toEqual({ width: 792, height: 612 })
    expect(
      layoutSheet(settings({ size: 'custom', custom: { width: 300, height: 400 } }), {}, blank)
        .page,
    ).toEqual({ width: 300, height: 400 })
  })

  it('takes the size of the page before it with "Match image" pages', () => {
    const state = doc(2)
    const pages = [blankPage('first'), ...state.pages, blankPage('b1'), blankPage('b2')]
    state.pages = pages
    expect(sizeModel(pages, 3)?.id).toBe('p1')
    expect(sizeModel(pages, 4)?.id).toBe('p1')
    expect(sizeModel(pages, 0)?.id).toBe('p0')
    expect(sizeModel([blankPage('only')], 0)).toBeUndefined()

    const image = settings({ size: 'image', imageDpi: 96 })
    const like = sizeModel(pages, 3)
    // 240 × 160 px at 96 dpi: 180 × 120 pt, turned with the blank page.
    expect(layoutSheet(image, state.assets, blankPage('b1'), like).page).toEqual({
      width: 180,
      height: 120,
    })
    expect(layoutSheet(image, state.assets, { ...blankPage('b1'), turns: 1 }, like).page).toEqual({
      width: 120,
      height: 180,
    })
    // Nothing to match: Letter.
    expect(layoutSheet(image, {}, blankPage('only')).page).toEqual({ width: 612, height: 792 })
  })

  it('is named and announced as a blank page', () => {
    const before = doc(2)
    const after = docReducer(before, { type: 'insertBlank', id: 'b', after: 'p0' })
    expect(describeChange(before, after)).toBe('added blank page 2')
    expect(pageName(blankPage('b'), before.assets)).toBe('Blank page')
    expect(pageName(page('p', 'a0'), before.assets)).toBe('a0.jpg')
  })
})
