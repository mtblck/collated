import { describe, expect, it } from 'vitest'
import { asset, page, settings } from '../../tests/helpers'
import { describeChange } from './describeChange'
import type { DocState } from './model'

const a = asset('a')
const doc = (ids: string[], patch: Partial<DocState> = {}): DocState => ({
  settings: settings(),
  assets: { a },
  pages: ids.map((id) => page(id, 'a')),
  ...patch,
})

describe('describeChange', () => {
  it('names added and removed pages by their position', () => {
    const before = doc(['p1', 'p2', 'p3'])
    expect(describeChange(before, { ...before, pages: before.pages.toSpliced(1, 1) })).toBe(
      'removed page 2',
    )
    expect(describeChange(before, { ...before, pages: [] })).toBe('removed 3 pages')
    expect(describeChange(doc([]), before)).toBe('added 3 pages')
    expect(
      describeChange(before, { ...before, pages: before.pages.toSpliced(1, 0, page('x', 'a')) }),
    ).toBe('added page 2')
  })

  it('names the page that moved', () => {
    const before = doc(['p1', 'p2', 'p3'])
    const [p1, p2, p3] = before.pages
    if (!p1 || !p2 || !p3) throw new Error('pages')
    expect(describeChange(before, { ...before, pages: [p2, p3, p1] })).toBe(
      'moved page 1 to position 3',
    )
  })

  it('counts the pages that moved together (#65)', () => {
    const before = doc(['p1', 'p2', 'p3', 'p4', 'p5'])
    const [p1, p2, p3, p4, p5] = before.pages
    if (!p1 || !p2 || !p3 || !p4 || !p5) throw new Error('pages')
    expect(describeChange(before, { ...before, pages: [p3, p4, p1, p2, p5] })).toBe('moved 2 pages')
    expect(describeChange(before, { ...before, pages: [p2, p1, p4, p3, p5] })).toBe('moved 2 pages')
  })

  it('names edited pages and changed settings', () => {
    const before = doc(['p1', 'p2'])
    const [p1, p2] = before.pages
    if (!p1 || !p2) throw new Error('pages')
    expect(describeChange(before, { ...before, pages: [p1, { ...p2, turns: 1 }] })).toBe(
      'edited page 2',
    )
    expect(
      describeChange(before, { ...before, pages: before.pages.map((p) => ({ ...p, turns: 1 })) }),
    ).toBe('edited 2 pages')
    expect(describeChange(before, { ...before, settings: settings({ margin: 36 }) })).toBe(
      'changed margin',
    )
    expect(
      describeChange(before, { ...before, settings: settings({ margin: 36, size: 'letter' }) }),
    ).toBe('changed document settings')
    expect(describeChange(before, before)).toBeNull()
  })
})
