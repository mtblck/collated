import { describe, expect, it } from 'vitest'
import { asset, doc, page, settings } from '../../tests/helpers'
import type { DocState } from './model'
import { docReducer } from './reducer'
import { duplexGroups } from './order'

const ids = (state: DocState) => state.pages.map((p) => p.id)

/** `fronts` pages from fronts.pdf then `backs` from backs.pdf, as a scanner makes them. */
const scan = (fronts: number, backs: number): DocState => {
  const make = (file: string, prefix: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      asset(`${prefix}${i + 1}`, {
        bytesId: file,
        format: 'pdf',
        pdfPage: i,
        name: `${file} · p${i + 1}`,
      }),
    )
  const assets = [...make('fronts.pdf', 'f', fronts), ...make('backs.pdf', 'b', backs)]
  return {
    settings: settings(),
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
    pages: assets.map((a) => page(a.id, a.id)),
  }
}

const interleaveWhole = (state: DocState, backsReversed: boolean) => {
  const groups = duplexGroups(state)
  if (!groups) throw new Error('no groups')
  return docReducer(state, {
    type: 'interleavePages',
    fronts: groups.fronts,
    backs: groups.backs,
    backsReversed,
  })
}

describe('interleave', () => {
  it('pairs fronts with reversed backs for an even count', () => {
    // Backs come out of the scanner last first: b1 is the back of f3.
    expect(ids(interleaveWhole(scan(3, 3), true))).toEqual(['f1', 'b3', 'f2', 'b2', 'f3', 'b1'])
  })

  it('pairs them in order when the backs are not reversed', () => {
    expect(ids(interleaveWhole(scan(2, 2), false))).toEqual(['f1', 'b1', 'f2', 'b2'])
  })

  it('puts the extra fronts or backs at the end when the counts differ', () => {
    expect(ids(interleaveWhole(scan(3, 1), false))).toEqual(['f1', 'b1', 'f2', 'f3'])
    expect(ids(interleaveWhole(scan(1, 3), true))).toEqual(['f1', 'b3', 'b2', 'b1'])
  })

  it('splits a single import in half, the odd page going to the fronts', () => {
    const groups = duplexGroups(doc(5))
    expect(groups).toMatchObject({ fronts: ['p0', 'p1', 'p2'], backs: ['p3', 'p4'], by: 'halves' })
    expect(ids(interleaveWhole(doc(5), true))).toEqual(['p0', 'p4', 'p1', 'p3', 'p2'])
    expect(ids(interleaveWhole(doc(4), false))).toEqual(['p0', 'p2', 'p1', 'p3'])
  })

  it('takes two imports one after the other as the two piles', () => {
    expect(duplexGroups(scan(3, 2))).toEqual({
      fronts: ['f1', 'f2', 'f3'],
      backs: ['b1', 'b2'],
      by: 'imports',
      names: ['fronts.pdf', 'backs.pdf'],
    })
    // Two batches of photos, told apart by `source`.
    const photos = doc(4)
    for (const [i, p] of photos.pages.entries()) {
      const a = photos.assets[p.assetId]
      if (a) photos.assets[p.assetId] = { ...a, source: i < 3 ? 'one' : 'two' }
    }
    expect(duplexGroups(photos)).toMatchObject({
      fronts: ['p0', 'p1', 'p2'],
      backs: ['p3'],
      names: ['a0.jpg and others', 'a3.jpg'],
    })
  })

  it('takes two separate runs of selected pages as the two piles', () => {
    expect(duplexGroups(doc(6), ['p0', 'p1', 'p3', 'p4', 'p5'])).toMatchObject({
      fronts: ['p0', 'p1'],
      backs: ['p3', 'p4', 'p5'],
      by: 'imports',
    })
    // One run, or three, is split in half.
    expect(duplexGroups(doc(6), ['p1', 'p2', 'p3'])).toMatchObject({
      fronts: ['p1', 'p2'],
      backs: ['p3'],
      by: 'halves',
    })
    expect(duplexGroups(doc(6), ['p0', 'p2', 'p4', 'p5'])).toMatchObject({ by: 'halves' })
  })

  it('works on two groups inside a document, leaving the other pages alone', () => {
    const state = doc(6)
    const next = docReducer(state, {
      type: 'interleavePages',
      fronts: ['p1', 'p2'],
      backs: ['p3', 'p4'],
      backsReversed: true,
    })
    expect(ids(next)).toEqual(['p0', 'p1', 'p4', 'p2', 'p3', 'p5'])
  })

  it('does nothing without both piles, and has no split under two pages', () => {
    const state = doc(3)
    const same = (fronts: string[], backs: string[]) =>
      docReducer(state, { type: 'interleavePages', fronts, backs, backsReversed: true })
    expect(same(['p0', 'p1'], [])).toBe(state)
    expect(same(['p0'], ['p0'])).toBe(state)
    expect(same(['nope'], ['p1'])).toBe(state)
    expect(duplexGroups(doc(1))).toBeNull()
  })
})

describe('reverse', () => {
  it('reverses odd and even counts, or just the given pages in their places', () => {
    expect(ids(docReducer(doc(3), { type: 'reversePages' }))).toEqual(['p2', 'p1', 'p0'])
    expect(ids(docReducer(doc(4), { type: 'reversePages' }))).toEqual(['p3', 'p2', 'p1', 'p0'])
    expect(ids(docReducer(doc(4), { type: 'reversePages', ids: ['p0', 'p2'] }))).toEqual([
      'p2',
      'p1',
      'p0',
      'p3',
    ])
    const one = doc(1)
    expect(docReducer(one, { type: 'reversePages' })).toBe(one)
  })
})

describe('sort', () => {
  const named = (names: string[], dates: (number | undefined)[] = []): DocState => {
    const state = doc(names.length)
    for (const [i, name] of names.entries()) {
      const date = dates[i]
      state.assets[`a${i}`] = asset(`a${i}`, {
        name,
        ...(date === undefined ? {} : { capturedAt: date }),
      })
    }
    return state
  }

  it('sorts by file name, with numbers in order', () => {
    const state = named(['scan 10.jpg', 'Scan 2.jpg', 'scan 1.jpg'])
    expect(ids(docReducer(state, { type: 'sortPages', by: 'name' }))).toEqual(['p2', 'p1', 'p0'])
  })

  it('sorts by date taken, ties kept in order and undated pages last', () => {
    const state = named(['a', 'b', 'c', 'd'], [300, undefined, 100, 300])
    expect(ids(docReducer(state, { type: 'sortPages', by: 'date' }))).toEqual([
      'p2',
      'p0',
      'p3',
      'p1',
    ])
  })

  it('leaves a sorted document as it is, so there is nothing to undo', () => {
    const state = named(['a', 'b'])
    expect(docReducer(state, { type: 'sortPages', by: 'name' })).toBe(state)
  })
})
