import { describe, expect, it } from 'vitest'
import { doc } from '../../tests/helpers'
import {
  EMPTY_SELECTION,
  blockDropIndex,
  keepExisting,
  pick,
  pickModeOf,
  selectAll,
} from './selection'

const { pages } = doc(6)

describe('selection (#65)', () => {
  it('reads the pick mode from the modifier keys', () => {
    const keys = { shiftKey: false, metaKey: false, ctrlKey: false }
    expect(pickModeOf(keys)).toBe('only')
    expect(pickModeOf({ ...keys, metaKey: true })).toBe('toggle')
    expect(pickModeOf({ ...keys, ctrlKey: true })).toBe('toggle')
    expect(pickModeOf({ ...keys, shiftKey: true, ctrlKey: true })).toBe('range')
  })

  it('selects one page, toggles others in document order, and toggles them off', () => {
    let s = pick(pages, EMPTY_SELECTION, 'p3', 'only')
    expect(s).toEqual({ ids: ['p3'], anchor: 'p3' })
    s = pick(pages, s, 'p1', 'toggle')
    expect(s).toEqual({ ids: ['p1', 'p3'], anchor: 'p1' })
    s = pick(pages, s, 'p1', 'toggle')
    expect(s).toEqual({ ids: ['p3'], anchor: 'p3' })
    s = pick(pages, s, 'p3', 'toggle')
    expect(s).toEqual({ ids: [], anchor: null })
    expect(pick(pages, s, 'nope', 'only')).toBe(s)
  })

  it('selects a range from the anchor either way, replacing the rest', () => {
    let s = pick(pages, EMPTY_SELECTION, 'p2', 'only')
    s = pick(pages, s, 'p4', 'range')
    expect(s).toEqual({ ids: ['p2', 'p3', 'p4'], anchor: 'p2' })
    s = pick(pages, s, 'p0', 'range')
    expect(s).toEqual({ ids: ['p0', 'p1', 'p2'], anchor: 'p2' })
    // With no anchor, a range is just that page.
    expect(pick(pages, EMPTY_SELECTION, 'p4', 'range')).toEqual({ ids: ['p4'], anchor: 'p4' })
  })

  it('selects all, keeping the anchor', () => {
    const s = selectAll(pages, { ids: ['p3'], anchor: 'p3' })
    expect(s.ids).toHaveLength(6)
    expect(s.anchor).toBe('p3')
    expect(selectAll(pages, EMPTY_SELECTION).anchor).toBe('p0')
  })

  it('drops pages that no longer exist and follows the new order', () => {
    const s = { ids: ['p1', 'p4'], anchor: 'p4' }
    expect(keepExisting(pages, s)).toBe(s)
    const fewer = pages.filter((p) => p.id !== 'p4').toReversed()
    expect(keepExisting(fewer, s)).toEqual({ ids: ['p1'], anchor: 'p1' })
    expect(keepExisting(pages.toReversed(), s)).toEqual({ ids: ['p4', 'p1'], anchor: 'p4' })
  })

  it('puts a dragged block where its dragged page was dropped', () => {
    // p1 and p3 selected; p3 dragged to the front: the block goes first.
    expect(blockDropIndex(pages, ['p1', 'p3'], 3, 0)).toBe(0)
    // p1 dragged to after p4 (index 4 once moved): after p0, p2, p4.
    expect(blockDropIndex(pages, ['p1', 'p3'], 1, 4)).toBe(3)
    // To the end.
    expect(blockDropIndex(pages, ['p1', 'p3'], 1, 5)).toBe(4)
  })
})
