import { describe, expect, it } from 'vitest'
import { asset, doc } from '../../tests/helpers'
import { PAGE_MAX, PAGE_MIN, docReducer } from './reducer'

const ids = (state: { pages: { id: string }[] }) => state.pages.map((p) => p.id)

describe('docReducer', () => {
  it('appends imported pages, or inserts them at an index', () => {
    const start = doc(2)
    const appended = docReducer(start, { type: 'addPages', assets: [asset('n')], pageIds: ['pn'] })
    expect(ids(appended)).toEqual(['p0', 'p1', 'pn'])
    expect(appended.assets.n).toBeDefined()
    const inserted = docReducer(start, {
      type: 'addPages',
      assets: [asset('n')],
      pageIds: ['pn'],
      at: 1,
    })
    expect(ids(inserted)).toEqual(['p0', 'pn', 'p1'])
  })

  it('moves a page forwards and backwards and ignores out-of-range moves', () => {
    const start = doc(4)
    expect(ids(docReducer(start, { type: 'movePage', from: 0, to: 2 }))).toEqual([
      'p1',
      'p2',
      'p0',
      'p3',
    ])
    expect(ids(docReducer(start, { type: 'movePage', from: 3, to: 0 }))).toEqual([
      'p3',
      'p0',
      'p1',
      'p2',
    ])
    expect(docReducer(start, { type: 'movePage', from: 0, to: 9 })).toBe(start)
    expect(docReducer(start, { type: 'movePage', from: 1, to: 1 })).toBe(start)
  })

  it('removes a page but keeps its image so undo can restore it', () => {
    const next = docReducer(doc(2), { type: 'removePage', id: 'p0' })
    expect(ids(next)).toEqual(['p1'])
    expect(next.assets.a0).toBeDefined()
  })

  it('duplicates a page right after itself, sharing the image', () => {
    const next = docReducer(doc(2), { type: 'duplicatePage', id: 'p0', newId: 'copy' })
    expect(ids(next)).toEqual(['p0', 'copy', 'p1'])
    expect(next.pages[1]?.assetId).toBe('a0')
  })

  it('rotates in quarter turns that wrap both ways', () => {
    let state = doc(1)
    state = docReducer(state, { type: 'rotatePage', id: 'p0', by: -1 })
    expect(state.pages[0]?.turns).toBe(3)
    state = docReducer(state, { type: 'rotatePage', id: 'p0', by: 1 })
    state = docReducer(state, { type: 'rotatePage', id: 'p0', by: 1 })
    expect(state.pages[0]?.turns).toBe(1)
    const all = docReducer(doc(3), { type: 'rotateAll', by: 1 })
    expect(all.pages.map((p) => p.turns)).toEqual([1, 1, 1])
  })

  it('clamps fine angle and scale to their limits', () => {
    const next = docReducer(doc(1), {
      type: 'transformPage',
      id: 'p0',
      patch: { angle: 90, scale: 99 },
    })
    expect(next.pages[0]?.angle).toBe(45)
    expect(next.pages[0]?.scale).toBe(4)
    const low = docReducer(doc(1), {
      type: 'transformPage',
      id: 'p0',
      patch: { angle: -90, scale: 0 },
    })
    expect(low.pages[0]?.angle).toBe(-45)
    expect(low.pages[0]?.scale).toBe(0.1)
  })

  it('transforms several pages in one step, clamping each', () => {
    const next = docReducer(doc(3), {
      type: 'transformPages',
      patches: [
        { id: 'p0', patch: { angle: 2.5 } },
        { id: 'p2', patch: { angle: -99 } },
      ],
    })
    expect(next.pages.map((p) => p.angle)).toEqual([2.5, 0, -45])
    const same = doc(1)
    expect(docReducer(same, { type: 'transformPages', patches: [] })).toBe(same)
    // Pages that are gone (the document was cleared meanwhile): no change, no undo step.
    expect(
      docReducer(same, { type: 'transformPages', patches: [{ id: 'gone', patch: { angle: 1 } }] }),
    ).toBe(same)
  })

  it('transforms one picture of a combined page, leaving the others', () => {
    const sheet = docReducer(doc(2), {
      type: 'combinePages',
      ids: ['p0', 'p1'],
      kind: 'two',
      newIds: ['s0'],
    })
    const next = docReducer(sheet, {
      type: 'transformPages',
      patches: [{ id: 's0', slot: 1, patch: { turns: 2 } }],
    })
    expect(next.pages[0]?.sheet?.slots.map((s) => s.turns)).toEqual([0, 2])
  })

  it('resets a page and copies one page’s transform to every page', () => {
    let state = docReducer(doc(3), {
      type: 'transformPage',
      id: 'p1',
      patch: { turns: 2, angle: 3, scale: 0.8, fit: 'cover' },
    })
    state = docReducer(state, { type: 'applyToAll', id: 'p1' })
    expect(state.pages.every((p) => p.turns === 2 && p.angle === 3 && p.fit === 'cover')).toBe(true)
    state = docReducer(state, { type: 'resetPage', id: 'p0' })
    expect(state.pages[0]).toMatchObject({ turns: 0, angle: 0, scale: 1, fit: 'contain' })
  })

  it('clamps settings to sane page sizes and margins', () => {
    const next = docReducer(doc(0), {
      type: 'setSettings',
      patch: { custom: { width: 1, height: 1e9 }, margin: -5 },
    })
    expect(next.settings.custom).toEqual({ width: PAGE_MIN, height: PAGE_MAX })
    expect(next.settings.margin).toBe(0)
  })

  it('clears every page and image', () => {
    const next = docReducer(doc(3), { type: 'clear' })
    expect(next.pages).toEqual([])
    expect(next.assets).toEqual({})
  })

  describe('several pages at once (#65)', () => {
    it('removes, duplicates and rotates just the given pages', () => {
      const start = doc(4)
      expect(ids(docReducer(start, { type: 'removePages', ids: ['p1', 'p3'] }))).toEqual([
        'p0',
        'p2',
      ])
      expect(docReducer(start, { type: 'removePages', ids: ['nope'] })).toBe(start)
      expect(
        ids(docReducer(start, { type: 'duplicatePages', ids: ['p0', 'p2'], newIds: ['c0', 'c2'] })),
      ).toEqual(['p0', 'c0', 'p1', 'p2', 'c2', 'p3'])
      const turned = docReducer(start, { type: 'rotatePages', ids: ['p1', 'p2'], by: -1 })
      expect(turned.pages.map((p) => p.turns)).toEqual([0, 3, 3, 0])
    })

    it('moves a block to an index among the pages left', () => {
      const start = doc(5)
      expect(ids(docReducer(start, { type: 'movePages', ids: ['p3', 'p1'], at: 0 }))).toEqual([
        'p1',
        'p3',
        'p0',
        'p2',
        'p4',
      ])
      expect(ids(docReducer(start, { type: 'movePages', ids: ['p0', 'p2'], at: 9 }))).toEqual([
        'p1',
        'p3',
        'p4',
        'p0',
        'p2',
      ])
      expect(docReducer(start, { type: 'movePages', ids: ['p0', 'p1'], at: 0 })).toBe(start)
    })

    it('shifts each page one place past its unselected neighbour', () => {
      const start = doc(5)
      expect(ids(docReducer(start, { type: 'shiftPages', ids: ['p1', 'p2'], by: -1 }))).toEqual([
        'p1',
        'p2',
        'p0',
        'p3',
        'p4',
      ])
      expect(ids(docReducer(start, { type: 'shiftPages', ids: ['p0', 'p3'], by: 1 }))).toEqual([
        'p1',
        'p0',
        'p2',
        'p4',
        'p3',
      ])
      // Pages already at the end stay; the others still move.
      expect(ids(docReducer(start, { type: 'shiftPages', ids: ['p0', 'p2'], by: -1 }))).toEqual([
        'p0',
        'p2',
        'p1',
        'p3',
        'p4',
      ])
      expect(docReducer(start, { type: 'shiftPages', ids: ['p0', 'p1'], by: -1 })).toBe(start)
    })
  })
})
