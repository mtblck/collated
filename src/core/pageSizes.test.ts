import { describe, expect, it } from 'vitest'
import { PAGE_SIZES, baseSize, localeDefaults, pageSize } from './pageSizes'

describe('page sizes', () => {
  it('has ISO sizes to the millimetre and US sizes to the point', () => {
    const a4 = PAGE_SIZES.find((p) => p.id === 'a4')
    expect(a4?.width).toBeCloseTo(595.28, 1)
    expect(a4?.height).toBeCloseTo(841.89, 1)
    expect(baseSize({ size: 'letter', custom: { width: 1, height: 1 } })).toEqual({
      width: 612,
      height: 792,
    })
  })

  it('uses the custom size when asked', () => {
    expect(baseSize({ size: 'custom', custom: { width: 300, height: 200 } })).toEqual({
      width: 300,
      height: 200,
    })
  })

  it('turns the page to match the image when orientation is auto', () => {
    const s = {
      size: 'letter' as const,
      custom: { width: 0, height: 0 },
      orientation: 'auto' as const,
    }
    expect(pageSize(s, true)).toEqual({ width: 792, height: 612 })
    expect(pageSize(s, false)).toEqual({ width: 612, height: 792 })
  })

  it('honours a fixed orientation regardless of the image, even for a landscape custom size', () => {
    const custom = { width: 500, height: 300 }
    expect(pageSize({ size: 'custom', custom, orientation: 'portrait' }, true)).toEqual({
      width: 300,
      height: 500,
    })
    expect(pageSize({ size: 'custom', custom, orientation: 'landscape' }, false)).toEqual({
      width: 500,
      height: 300,
    })
  })

  it('defaults to Letter + inches in North America and A4 + mm elsewhere', () => {
    expect(localeDefaults('en-US')).toEqual({ size: 'letter', unit: 'in' })
    expect(localeDefaults('fr-CA')).toEqual({ size: 'letter', unit: 'in' })
    expect(localeDefaults('en-GB')).toEqual({ size: 'a4', unit: 'mm' })
    expect(localeDefaults('de')).toEqual({ size: 'a4', unit: 'mm' })
    expect(localeDefaults('not a locale!')).toEqual({ size: 'a4', unit: 'mm' })
  })
})
