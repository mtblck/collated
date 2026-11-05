import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINT,
  bookletOrder,
  bookletSheets,
  imposition,
  posterSheets,
  printCount,
  printPaper,
} from './impose'

const A4 = { width: 595.28, height: 841.89 }
const one = (n: number | null) => (n === null ? null : n + 1)

describe('bookletOrder', () => {
  it('puts 8 pages two to a side so the folded stack reads 1–8', () => {
    expect(bookletOrder(8).map(([l, r]) => [one(l), one(r)])).toEqual([
      [8, 1],
      [2, 7],
      [6, 3],
      [4, 5],
    ])
  })

  it('pads to a multiple of 4 with empty slots at the end', () => {
    expect(bookletOrder(5).map(([l, r]) => [one(l), one(r)])).toEqual([
      [null, 1],
      [2, null],
      [null, 3],
      [4, 5],
    ])
    expect(bookletOrder(1)).toEqual([
      [null, 0],
      [null, null],
    ])
    expect(bookletOrder(0)).toEqual([])
  })

  it('uses every page exactly once', () => {
    for (let n = 1; n <= 40; n++) {
      const used = bookletOrder(n)
        .flat()
        .filter((i) => i !== null)
        .sort((a, b) => a - b)
      expect(used).toEqual([...Array(n).keys()])
      expect(bookletOrder(n)).toHaveLength(Math.ceil(n / 4) * 2)
    }
  })

  it('folds: nesting the sheets and reading the halves in turn gives 1, 2, 3…', () => {
    // Read a folded booklet: for each sheet from the outside in, the right
    // of the front, then the back left and right; the rest comes back out.
    const sides = bookletOrder(12)
    const sheets = sides.length / 2
    const read: (number | null)[] = []
    for (let s = 0; s < sheets; s++) {
      const front = sides[2 * s]
      const back = sides[2 * s + 1]
      if (!front || !back) throw new Error('setup')
      read[s * 2] = front[1]
      read[s * 2 + 1] = back[0]
      read[sheets * 4 - 1 - s * 2] = front[0]
      read[sheets * 4 - 2 - s * 2] = back[1]
    }
    expect(read).toEqual([...Array(12).keys()])
  })
})

describe('bookletSheets', () => {
  it('turns the paper landscape and fits each page to its half, against the fold', () => {
    const sheets = bookletSheets([A4, A4, A4, A4], A4)
    // One sheet, both sides.
    expect(sheets).toHaveLength(2)
    const [front] = sheets
    expect(front?.size).toEqual({ width: A4.height, height: A4.width })
    const [left, right] = front?.pages ?? []
    // A4 on half an A4 is A5: scaled by 1/√2.
    expect(left?.scale).toBeCloseTo(Math.SQRT1_2, 3)
    expect(left?.page).toBe(3)
    expect((left?.x ?? 0) + A4.width * (left?.scale ?? 0)).toBeCloseTo(A4.height / 2, 3)
    expect(right?.page).toBe(0)
    expect(right?.x).toBeCloseTo(A4.height / 2, 3)
  })

  it('centres a wide page top to bottom in its half', () => {
    const wide = { width: 800, height: 400 }
    const [front] = bookletSheets([wide], A4)
    const [only] = front?.pages ?? []
    const half = A4.height / 2
    expect(only?.scale).toBeCloseTo(half / 800, 5)
    expect(only?.y).toBeCloseTo((A4.width - 400 * (half / 800)) / 2, 5)
  })
})

describe('posterSheets', () => {
  const poster = {
    kind: 'poster' as const,
    paper: A4,
    across: 3,
    down: 2,
    overlap: 20,
    cutMarks: true,
  }

  it('cuts each page into across × down tiles that meet with the overlap', () => {
    const page = { width: 600, height: 400 }
    const sheets = posterSheets([page, page], poster)
    expect(sheets).toHaveLength(12)
    // Landscape sheets give a bigger landscape poster.
    const sheet = sheets[0]?.size ?? A4
    expect(sheet.width).toBeCloseTo(A4.height, 3)
    const [a, b, , d] = sheets.map((s) => s.pages[0])
    // The next tile across starts one sheet less the overlap further on.
    expect((a?.x ?? 0) - (b?.x ?? 0)).toBeCloseTo(sheet.width - 20, 5)
    expect((a?.y ?? 0) - (d?.y ?? 0)).toBeCloseTo(sheet.height - 20, 5)
    expect(sheets[6]?.pages[0]?.page).toBe(1)
    // The whole poster fits the grid, centred.
    const width = 3 * sheet.width - 2 * 20
    const height = 2 * sheet.height - 20
    const scale = Math.min(width / 600, height / 400)
    expect(a?.scale).toBeCloseTo(scale, 5)
    expect(a?.x).toBeCloseTo((width - 600 * scale) / 2, 5)
    expect(a?.y).toBeCloseTo((height - 400 * scale) / 2, 5)
  })

  it('marks cuts on the strips shared with the neighbours left and above', () => {
    const sheets = posterSheets([{ width: 600, height: 400 }], poster)
    expect(sheets.map((s) => s.cuts)).toEqual([
      [],
      [{ axis: 'x', at: 20 }],
      [{ axis: 'x', at: 20 }],
      [{ axis: 'y', at: 20 }],
      [
        { axis: 'x', at: 20 },
        { axis: 'y', at: 20 },
      ],
      [
        { axis: 'x', at: 20 },
        { axis: 'y', at: 20 },
      ],
    ])
    expect(sheets.map((s) => s.label?.text)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3'])
    // The first sheet's label is in the strip the next one covers.
    const first = sheets[0]
    expect(first?.label?.x).toBeCloseTo((first?.size.width ?? 0) - 10, 5)
  })

  it('leaves out sheets that would hold none of the page', () => {
    // A portrait A4 across 4 × 1 A4 sheets stays one sheet high: the two
    // outer sheets fall in the margin.
    const sheets = posterSheets([A4], { ...poster, across: 4, down: 1 })
    expect(sheets.map((s) => s.label?.text)).toEqual(['A2', 'A3'])
  })

  it('leaves marks and labels off when asked, or when there is nothing to join', () => {
    expect(
      posterSheets([A4], { ...poster, cutMarks: false }).every((s) => !s.cuts.length && !s.label),
    ).toBe(true)
    const single = posterSheets([A4], { ...poster, across: 1, down: 1 })
    expect(single).toHaveLength(1)
    expect(single[0]?.label).toBeUndefined()
    expect(single[0]?.pages[0]?.scale).toBeCloseTo(1, 5)
  })
})

describe('imposition', () => {
  const settings = { size: 'letter' as const, custom: { width: 100, height: 200 } }

  it('is none for pages as they are', () => {
    expect(imposition(DEFAULT_PRINT, settings, 'a4')).toBeUndefined()
  })

  it('takes the paper from the pages, else the local paper', () => {
    expect(printPaper('document', settings, 'a4')).toEqual({ width: 612, height: 792 })
    expect(printPaper('document', { ...settings, size: 'image' }, 'a4').width).toBeCloseTo(
      595.28,
      1,
    )
    expect(printPaper('a3', settings, 'a4').height).toBeCloseTo(1190.55, 1)
    expect(
      printPaper('document', { size: 'custom', custom: { width: 300, height: 200 } }, 'a4'),
    ).toEqual({ width: 200, height: 300 })
  })

  it('keeps the grid and overlap in range', () => {
    const got = imposition(
      { ...DEFAULT_PRINT, kind: 'poster', across: 40, down: 0, overlap: 1000 },
      settings,
      'a4',
    )
    expect(got).toMatchObject({ across: 8, down: 1 })
    // Never more than a quarter of the paper, however small it is.
    const tiny = imposition(
      { ...DEFAULT_PRINT, kind: 'poster', paper: 'document', overlap: 80 },
      { size: 'custom', custom: { width: 72, height: 100 } },
      'a4',
    )
    expect(tiny?.kind === 'poster' && tiny.overlap).toBe(18)
    expect(got?.kind === 'poster' && got.overlap).toBeCloseTo(85.04, 1)
  })

  it('counts sheets and printed sides', () => {
    expect(printCount({ kind: 'booklet', across: 1, down: 1 }, 9)).toEqual({ sheets: 3, sides: 6 })
    expect(printCount({ kind: 'poster', across: 2, down: 3 }, 2)).toEqual({ sheets: 12, sides: 12 })
    expect(printCount({ kind: 'pages', across: 2, down: 3 }, 2)).toEqual({ sheets: 2, sides: 2 })
  })
})
