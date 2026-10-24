import { describe, expect, it } from 'vitest'
import { doc } from '../../tests/helpers'
import { partFilename, zipFilename } from './filename'
import {
  DEFAULT_SPLIT,
  describePlan,
  pagesUsed,
  parseRanges,
  planExport,
  positionList,
  type Plan,
  type SplitOptions,
} from './split'

const { pages } = doc(12)
const plan = (patch: Partial<SplitOptions>, selected: string[] = [], start = 1) =>
  planExport(pages, selected, { ...DEFAULT_SPLIT, ...patch }, start)
const parts = (p: Plan) => ('error' in p ? p.error : p.parts.map((part) => part.pageIds))
const starts = (p: Plan) => ('error' in p ? p.error : p.parts.map((part) => part.start))

describe('page ranges (#66)', () => {
  it('reads ranges, single pages and open ends, in the order written', () => {
    expect(parseRanges('1-3, 4-10', 12)).toEqual({
      ranges: [
        [1, 3],
        [4, 10],
      ],
    })
    expect(parseRanges(' 5 ; 8 – 9  11-', 12)).toEqual({
      ranges: [
        [5, 5],
        [8, 9],
        [11, 12],
      ],
    })
    expect(parseRanges('-2, 10-12, 1-3', 12)).toEqual({
      ranges: [
        [1, 2],
        [10, 12],
        [1, 3],
      ],
    })
  })

  it('says what is wrong with ranges it can’t use', () => {
    expect(parseRanges('  ', 12)).toEqual({ error: 'Enter page ranges, like 1-3, 4-10.' })
    expect(parseRanges('1-3, x', 12)).toEqual({
      error: '“x” isn’t a page or a range. Write them like 1-3, 4-10.',
    })
    expect(JSON.stringify(parseRanges('-', 12))).toContain('isn’t a page')
    expect(JSON.stringify(parseRanges('1-2-3', 12))).toContain('“1-2-3”')
    expect(parseRanges('0-3', 12)).toEqual({ error: 'Pages are numbered from 1.' })
    expect(parseRanges('10-14', 12)).toEqual({
      error: 'There’s no page 14: the document has 12 pages.',
    })
    expect(parseRanges('5-3', 12)).toEqual({ error: '5-3 runs backwards. Write 3-5.' })
  })

  it('lists positions as short runs', () => {
    expect(positionList([1, 3, 4, 5, 9, 10])).toBe('1, 3–5, 9–10')
    expect(positionList([7])).toBe('7')
  })
})

describe('planning an export (#66)', () => {
  it('exports every page as one file by default', () => {
    const p = plan({})
    expect(parts(p)).toEqual([pages.map((x) => x.id)])
    expect(describePlan(p, 'all')).toBeNull()
  })

  it('exports only the selected pages, in document order', () => {
    const p = plan({ mode: 'selection' }, ['p7', 'p2', 'p3'])
    expect(parts(p)).toEqual([['p2', 'p3', 'p7']])
    expect(describePlan(p, 'selection')).toBe('Pages 3–4, 8, as one PDF.')
    expect(plan({ mode: 'selection' }, [])).toEqual({ error: 'Select the pages to export first.' })
  })

  it('makes one file per range, with pages in order', () => {
    const p = plan({ mode: 'ranges', ranges: '1-3, 4-10, 11-' })
    expect(parts(p)).toEqual([
      ['p0', 'p1', 'p2'],
      ['p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
      ['p10', 'p11'],
    ])
    expect(describePlan(p, 'ranges')).toBe('3 PDFs in one ZIP: pages 1–3 · 4–10 · 11–12.')
    // One range is just those pages, as one PDF.
    expect(describePlan(plan({ mode: 'ranges', ranges: '3-5' }), 'ranges')).toBe(
      'Pages 3–5, as one PDF.',
    )
    expect(plan({ mode: 'ranges', ranges: '13' })).toEqual({
      error: 'There’s no page 13: the document has 12 pages.',
    })
  })

  it('splits every N pages, the last part holding what’s left', () => {
    expect(parts(plan({ mode: 'every', every: 5 }))).toEqual([
      ['p0', 'p1', 'p2', 'p3', 'p4'],
      ['p5', 'p6', 'p7', 'p8', 'p9'],
      ['p10', 'p11'],
    ])
    const single = plan({ mode: 'every', every: 1 })
    expect(parts(single)).toHaveLength(12)
    expect(describePlan(single, 'every')).toBe(
      '12 PDFs in one ZIP: pages 1 · 2 · 3 · 4 · 5 · 6 and 6 more.',
    )
    expect(parts(plan({ mode: 'every', every: 20 }))).toHaveLength(1)
    expect(plan({ mode: 'every', every: 0 })).toEqual({ error: 'Split every 1 page or more.' })
  })

  it('restarts page numbers in each file, or carries them on', () => {
    expect(starts(plan({ mode: 'every', every: 5 }, [], 3))).toEqual([3, 3, 3])
    expect(starts(plan({ mode: 'every', every: 5, numbering: 'continue' }, [], 3))).toEqual([
      3, 8, 13,
    ])
  })

  it('lists each page used once', () => {
    const p = plan({ mode: 'ranges', ranges: '2-3, 1-2' })
    expect('parts' in p && pagesUsed(p)).toEqual(['p1', 'p2', 'p0'])
  })

  it('names the parts from the title, numbered so they sort', () => {
    expect(partFilename('Lease 2026', 0, 3)).toBe('Lease-2026-part-1.pdf')
    expect(partFilename('Lease 2026', 8, 12)).toBe('Lease-2026-part-09.pdf')
    expect(zipFilename('Lease 2026')).toBe('Lease-2026.zip')
    expect(zipFilename('', new Date(2026, 9, 24))).toBe('scans-2026-10-24.zip')
  })
})
