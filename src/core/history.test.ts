import { describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, canRedo, canUndo, initHistory, withHistory } from './history'

const counter = withHistory((n: number, by: number) => n + by)
const zero = withHistory<number, number>((n) => n)

describe('withHistory', () => {
  it('undoes and redoes', () => {
    let h = initHistory(0)
    h = counter(h, { type: 'do', action: 1 })
    h = counter(h, { type: 'do', action: 2 })
    expect(h.present).toBe(3)
    h = counter(h, { type: 'undo' })
    expect(h.present).toBe(1)
    expect(canRedo(h)).toBe(true)
    h = counter(h, { type: 'redo' })
    expect(h.present).toBe(3)
  })

  it('drops the redo stack on a new change', () => {
    let h = counter(counter(initHistory(0), { type: 'do', action: 1 }), { type: 'undo' })
    h = counter(h, { type: 'do', action: 5 })
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe(5)
  })

  it('collapses a slider drag into one undo step until committed', () => {
    let h = initHistory(0)
    for (const by of [1, 1, 1]) h = counter(h, { type: 'do', action: by, coalesce: 'scale:p1' })
    expect(h.past).toEqual([0])
    h = counter(h, { type: 'commit' })
    h = counter(h, { type: 'do', action: 1, coalesce: 'scale:p1' })
    expect(h.past).toEqual([0, 3])
    h = counter(h, { type: 'undo' })
    expect(h.present).toBe(3)
  })

  it('ignores no-op actions and empty undo/redo', () => {
    const h = initHistory(0)
    expect(zero(h, { type: 'do', action: 1 })).toBe(h)
    expect(counter(h, { type: 'undo' })).toBe(h)
    expect(counter(h, { type: 'redo' })).toBe(h)
    expect(canUndo(h)).toBe(false)
  })

  it('keeps a bounded past', () => {
    let h = initHistory(0)
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = counter(h, { type: 'do', action: 1 })
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('reset', () => {
  it('replaces the document and forgets both directions of history', () => {
    const reduce = withHistory((n: number, by: number) => n + by)
    let h = initHistory(0)
    h = reduce(h, { type: 'do', action: 1 })
    h = reduce(h, { type: 'do', action: 1 })
    h = reduce(h, { type: 'undo' })
    h = reduce(h, { type: 'reset', present: 10 })
    expect(h).toEqual(initHistory(10))
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })
})
