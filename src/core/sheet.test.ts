import { describe, expect, it } from 'vitest'
import { asset, doc, page, settings } from '../../tests/helpers'
import { describeChange } from './describeChange'
import { ID_CARD, SHEET_GAP, layoutPage, layoutSheet } from './geometry'
import type { DocState, Page, SheetKind } from './model'
import { DEFAULT_TRANSFORM, pictureKey, picturesOf } from './model'
import { docReducer } from './reducer'

/** Combined pages (#76): several pictures on one page. */

const ids = (state: DocState) => state.pages.map((p) => p.id)

const combine = (state: DocState, pick: string[], kind: SheetKind = 'two') =>
  docReducer(state, { type: 'combinePages', ids: pick, kind, newIds: ['s0', 's1', 's2'] })

const sheetPage = (kind: SheetKind, assetIds: string[], looks: Partial<Page>[] = []): Page => ({
  id: 'sheet',
  assetId: assetIds[0] ?? '',
  ...DEFAULT_TRANSFORM,
  sheet: {
    kind,
    slots: assetIds.map((assetId, i) => ({ assetId, ...DEFAULT_TRANSFORM, ...looks[i] })),
  },
})

describe('combining and splitting pages', () => {
  it('puts the selected pages’ pictures on one page where the first of them was', () => {
    const start = doc(4)
    const next = combine(start, ['p3', 'p1'])
    expect(ids(next)).toEqual(['p0', 's0', 'p2'])
    const sheet = next.pages[1]
    expect(sheet?.sheet?.kind).toBe('two')
    // In document order, whatever order they were picked in.
    expect(sheet?.sheet?.slots.map((s) => s.assetId)).toEqual(['a1', 'a3'])
    expect(sheet?.assetId).toBe('a1')
  })

  it('keeps each picture’s rotation, crop and filter', () => {
    const corners = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ] as const
    const start = doc(2)
    start.pages[0] = page('p0', 'a0', { turns: 1, filter: 'bw', corners: [...corners] })
    start.pages[1] = page('p1', 'a1', { angle: 4, scale: 0.8, fit: 'cover' })
    const slots = combine(start, ['p0', 'p1']).pages[0]?.sheet?.slots
    expect(slots).toEqual([
      { assetId: 'a0', ...DEFAULT_TRANSFORM, turns: 1, filter: 'bw', corners: [...corners] },
      { assetId: 'a1', ...DEFAULT_TRANSFORM, angle: 4, scale: 0.8, fit: 'cover' },
    ])
  })

  it('fills as many pages as the pictures need, the last one part-empty', () => {
    const next = combine(doc(5), ['p0', 'p1', 'p2', 'p3', 'p4'], 'two')
    expect(ids(next)).toEqual(['s0', 's1', 's2'])
    expect(next.pages.map((p) => p.sheet?.slots.length)).toEqual([2, 2, 1])
    const four = combine(doc(5), ['p0', 'p1', 'p2', 'p3', 'p4'], 'four')
    expect(four.pages.map((p) => p.sheet?.slots.length)).toEqual([4, 1])
  })

  it('combines combined pages by their pictures', () => {
    const once = combine(doc(3), ['p0', 'p1'])
    const twice = docReducer(once, {
      type: 'combinePages',
      ids: ['s0', 'p2'],
      kind: 'four',
      newIds: ['big'],
    })
    expect(ids(twice)).toEqual(['big'])
    expect(twice.pages[0]?.sheet?.slots.map((s) => s.assetId)).toEqual(['a0', 'a1', 'a2'])
  })

  it('does nothing with fewer than two pictures', () => {
    const start = doc(2)
    expect(combine(start, ['p0'])).toBe(start)
    expect(combine(start, ['nope', 'p1'])).toBe(start)
  })

  it('splits a combined page back into its pages, as they were', () => {
    const start = doc(3)
    start.pages[1] = page('p1', 'a1', { turns: 3, filter: 'grey' })
    const combined = combine(start, ['p1', 'p2'])
    const split = docReducer(combined, { type: 'splitPage', id: 's0', newIds: ['x', 'y'] })
    expect(ids(split)).toEqual(['p0', 'x', 'y'])
    expect(split.pages[1]).toEqual(page('x', 'a1', { turns: 3, filter: 'grey' }))
    expect(split.pages[2]).toEqual(page('y', 'a2'))
    expect(split.pages[1]?.sheet).toBeUndefined()
    // Not a combined page: nothing to split.
    expect(docReducer(split, { type: 'splitPage', id: 'x', newIds: ['z'] })).toBe(split)
  })

  it('changes the layout only to one with room for every picture', () => {
    const two = combine(doc(2), ['p0', 'p1'])
    const card = docReducer(two, { type: 'setSheetKind', id: 's0', kind: 'id-card' })
    expect(card.pages[0]?.sheet?.kind).toBe('id-card')
    const three = combine(doc(3), ['p0', 'p1', 'p2'], 'four')
    expect(docReducer(three, { type: 'setSheetKind', id: 's0', kind: 'two' })).toBe(three)
  })

  it('treats a combined page as one page: duplicate, remove, move', () => {
    const start = combine(doc(3), ['p0', 'p1'])
    const copied = docReducer(start, { type: 'duplicatePage', id: 's0', newId: 'copy' })
    expect(ids(copied)).toEqual(['s0', 'copy', 'p2'])
    expect(copied.pages[1]?.sheet).toEqual(start.pages[0]?.sheet)
    expect(ids(docReducer(start, { type: 'removePage', id: 's0' }))).toEqual(['p2'])
    expect(ids(docReducer(start, { type: 'movePage', from: 0, to: 1 }))).toEqual(['p2', 's0'])
    // Removing keeps the assets, so undo has them.
    expect(docReducer(start, { type: 'removePage', id: 's0' }).assets.a0).toBeDefined()
  })

  it('rotates, edits and resets every picture on a combined page', () => {
    const start = combine(doc(2), ['p0', 'p1'])
    const turned = docReducer(start, { type: 'rotatePage', id: 's0', by: 1 })
    expect(turned.pages[0]?.sheet?.slots.map((s) => s.turns)).toEqual([1, 1])
    // The page's own look stays unused.
    expect(turned.pages[0]?.turns).toBe(0)
    const grey = docReducer(turned, {
      type: 'transformPages',
      patches: [{ id: 's0', patch: { filter: 'grey' } }],
    })
    expect(grey.pages[0]?.sheet?.slots.map((s) => s.filter)).toEqual(['grey', 'grey'])
    const reset = docReducer(grey, { type: 'resetPage', id: 's0' })
    expect(reset.pages[0]?.sheet?.slots.map((s) => [s.turns, s.filter])).toEqual([
      [0, 'original'],
      [0, 'original'],
    ])
  })

  it('keeps a filter off the PDF pictures of a combined page', () => {
    const start = doc(2)
    start.assets.a0 = asset('a0', { format: 'pdf' })
    const combined = combine(start, ['p0', 'p1'])
    const bw = docReducer(combined, {
      type: 'transformPages',
      patches: [{ id: 's0', patch: { filter: 'bw', angle: 2 } }],
    })
    expect(bw.pages[0]?.sheet?.slots.map((s) => [s.filter, s.angle])).toEqual([
      ['original', 2],
      ['bw', 2],
    ])
  })

  it('names pictures for their recognised words', () => {
    const [sheet] = combine(doc(2), ['p0', 'p1']).pages
    if (!sheet) throw new Error('setup')
    expect(picturesOf(sheet)).toHaveLength(2)
    expect(pictureKey(sheet, 1)).toBe('s0/1')
    expect(pictureKey(page('p', 'a'), 0)).toBe('p')
  })

  it('describes combining and splitting for undo', () => {
    const start = doc(3)
    const combined = combine(start, ['p0', 'p1'])
    expect(describeChange(start, combined)).toBe('combined 2 pages')
    const split = docReducer(combined, { type: 'splitPage', id: 's0', newIds: ['x', 'y'] })
    expect(describeChange(combined, split)).toBe('split page 1')
  })
})

describe('layoutSheet', () => {
  const landscape = { a: asset('a'), b: asset('b') }
  const letter = settings({ size: 'letter' })

  it('lays out a single page exactly as layoutPage does', () => {
    const p = page('p', 'a', { turns: 1, scale: 0.7 })
    const sheet = layoutSheet(letter, landscape, p)
    expect(sheet.pictures).toEqual([layoutPage(letter, landscape.a, p)])
    expect(sheet.page).toEqual(sheet.pictures[0]?.page)
  })

  it('stacks two wide pictures on a portrait page, a gap between them', () => {
    const sheet = layoutSheet(letter, landscape, sheetPage('two', ['a', 'b']))
    expect(sheet.page).toEqual({ width: 612, height: 792 })
    const [top, bottom] = sheet.pictures.map((p) => p.content)
    expect(top).toEqual({ x: 0, y: 0, width: 612, height: (792 - SHEET_GAP) / 2 })
    expect(bottom?.y).toBeCloseTo((792 + SHEET_GAP) / 2)
    // Each picture is fitted to its cell and centred in it.
    expect(sheet.pictures[0]?.image.height).toBeCloseTo((792 - SHEET_GAP) / 2)
    expect(sheet.pictures[1]?.image.cy).toBeCloseTo(792 - (792 - SHEET_GAP) / 4)
  })

  it('turns the page to Auto’s better fit: two tall pictures go side by side', () => {
    const tall = {
      a: asset('a', { width: 160, height: 240 }),
      b: asset('b', { width: 160, height: 240 }),
    }
    const sheet = layoutSheet(letter, tall, sheetPage('two', ['a', 'b']))
    expect(sheet.page).toEqual({ width: 792, height: 612 })
    expect(sheet.pictures[1]?.content.x).toBeCloseTo((792 + SHEET_GAP) / 2)
    // A chosen orientation is kept.
    const portrait = layoutSheet(
      settings({ size: 'letter', orientation: 'portrait' }),
      tall,
      sheetPage('two', ['a', 'b']),
    )
    expect(portrait.page).toEqual({ width: 612, height: 792 })
  })

  it('puts four pictures in a 2 × 2 grid inside the margins, keeping empty cells', () => {
    const assets = { a: asset('a'), b: asset('b'), c: asset('c') }
    const sheet = layoutSheet(
      settings({ size: 'letter', orientation: 'portrait', margin: 36 }),
      assets,
      sheetPage('four', ['a', 'b', 'c']),
    )
    const cells = sheet.pictures.map((p) => p.content)
    const w = (612 - 72 - SHEET_GAP) / 2
    const h = (792 - 72 - SHEET_GAP) / 2
    expect(cells).toEqual([
      { x: 36, y: 36, width: w, height: h },
      { x: 36 + w + SHEET_GAP, y: 36, width: w, height: h },
      { x: 36, y: 36 + h + SHEET_GAP, width: w, height: h },
    ])
    expect(sheet.content).toEqual({ x: 36, y: 36, width: 540, height: 720 })
  })

  it('prints ID card sides at 85.6 × 54 mm, centred, an upright card upright', () => {
    const assets = { a: asset('a'), b: asset('b', { width: 160, height: 240 }) }
    const a4 = settings({ size: 'a4' })
    const sheet = layoutSheet(a4, assets, sheetPage('id-card', ['a', 'b']))
    const [front, back] = sheet.pictures.map((p) => p.content)
    expect(front?.width).toBeCloseTo(ID_CARD.width)
    expect(front?.height).toBeCloseTo(ID_CARD.height)
    expect(back?.width).toBeCloseTo(ID_CARD.height)
    expect(back?.height).toBeCloseTo(ID_CARD.width)
    expect((front?.x ?? 0) + (front?.width ?? 0) / 2).toBeCloseTo(sheet.page.width / 2)
    expect(back?.y).toBeCloseTo((front?.y ?? 0) + ID_CARD.height + SHEET_GAP)
    // A turned picture turns its card.
    const turned = layoutSheet(a4, assets, sheetPage('id-card', ['a', 'b'], [{ turns: 1 }]))
    expect(turned.pictures[0]?.content.width).toBeCloseTo(ID_CARD.height)
  })

  it('shrinks ID cards together on a page too small for them', () => {
    const tiny = settings({ size: 'custom', custom: { width: 144, height: 144 } })
    const sheet = layoutSheet(tiny, landscape, sheetPage('id-card', ['a', 'b']))
    const [front] = sheet.pictures
    expect(front?.content.width).toBeLessThan(ID_CARD.width)
    expect((front?.content.width ?? 0) / (front?.content.height ?? 1)).toBeCloseTo(85.6 / 54)
  })

  it('sizes a “match image” page to hold each picture at its own size', () => {
    const s = settings({ size: 'image', imageDpi: 72, margin: 10 })
    const sheet = layoutSheet(s, landscape, sheetPage('two', ['a', 'b']))
    // 240 × 160 px at 72 dpi is 240 × 160 pt; wide pictures stack.
    expect(sheet.page).toEqual({ width: 260, height: 160 * 2 + SHEET_GAP + 20 })
    expect(sheet.pictures[0]?.image.width).toBeCloseTo(240)
    const card = layoutSheet(s, landscape, sheetPage('id-card', ['a', 'b']))
    expect(card.page.width).toBeCloseTo(ID_CARD.width + 20)
  })

  it('refuses a page whose picture is missing', () => {
    expect(() => layoutSheet(letter, landscape, sheetPage('two', ['a', 'gone']))).toThrow()
  })
})
