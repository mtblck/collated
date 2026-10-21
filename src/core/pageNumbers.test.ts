import { describe, expect, it } from 'vitest'
import { numberMark } from './pageNumbers'

const letter = { width: 612, height: 792 }
const on = { show: true, position: 'bottom-center' as const, start: 1 }

describe('numberMark', () => {
  it('is absent unless page numbers are switched on', () => {
    expect(numberMark({ ...on, show: false }, 0, letter, 36)).toBeNull()
  })

  it('counts from the start number', () => {
    expect(numberMark(on, 0, letter, 0)?.text).toBe('1')
    expect(numberMark({ ...on, start: 5 }, 2, letter, 0)?.text).toBe('7')
  })

  it('centres in the margin band when there is room, else sits 18 pt from the edge', () => {
    expect(numberMark(on, 0, letter, 72)).toMatchObject({
      x: 306,
      baseline: 792 - 36 + 3,
      align: 'center',
    })
    expect(numberMark(on, 0, letter, 0)).toMatchObject({ baseline: 792 - 18 + 3 })
  })

  it('aligns right for the corner positions', () => {
    expect(numberMark({ ...on, position: 'bottom-right' }, 0, letter, 0)).toMatchObject({
      x: 594,
      align: 'right',
    })
    expect(numberMark({ ...on, position: 'top-right' }, 0, letter, 0)).toMatchObject({
      x: 594,
      baseline: 21,
    })
  })
})
