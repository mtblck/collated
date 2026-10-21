import { describe, expect, it } from 'vitest'
import { asset, page, settings } from '../../tests/helpers'
import { isLandscape, layoutPage, rotatedBounds } from './geometry'

const letter = settings({ size: 'letter', orientation: 'portrait' })

describe('rotatedBounds', () => {
  it('swaps sides at a quarter turn and grows at 45°', () => {
    const quarter = rotatedBounds(200, 100, 90)
    expect(quarter.width).toBeCloseTo(100)
    expect(quarter.height).toBeCloseTo(200)
    const diag = rotatedBounds(100, 100, 45)
    expect(diag.width).toBeCloseTo(141.42, 1)
  })
})

describe('layoutPage', () => {
  it('fits a landscape image across a portrait page, centred', () => {
    const layout = layoutPage(letter, asset('a', { width: 2000, height: 1000 }), page('p', 'a'))
    expect(layout.page).toEqual({ width: 612, height: 792 })
    expect(layout.image.width).toBeCloseTo(612)
    expect(layout.image.height).toBeCloseTo(306)
    expect(layout.image.cx).toBe(306)
    expect(layout.image.cy).toBe(396)
  })

  it('fits the rotated bounding box, so a quarter turn fills the page height', () => {
    const layout = layoutPage(
      letter,
      asset('a', { width: 2000, height: 1000 }),
      page('p', 'a', { turns: 1 }),
    )
    // Sideways, the 2000px side runs down the page: limited by height 792.
    expect(layout.image.width).toBeCloseTo(792)
    expect(layout.image.rotation).toBe(90)
  })

  it('keeps a straightened image inside the printable area at scale 1', () => {
    const s = settings({ size: 'letter', orientation: 'portrait', margin: 36 })
    const layout = layoutPage(
      s,
      asset('a', { width: 1000, height: 1300 }),
      page('p', 'a', { angle: 7 }),
    )
    const b = rotatedBounds(layout.image.width, layout.image.height, 7)
    expect(b.width).toBeLessThanOrEqual(layout.content.width + 1e-6)
    expect(b.height).toBeLessThanOrEqual(layout.content.height + 1e-6)
  })

  it('fills the printable area in cover mode', () => {
    const layout = layoutPage(
      letter,
      asset('a', { width: 2000, height: 1000 }),
      page('p', 'a', { fit: 'cover' }),
    )
    expect(layout.image.height).toBeCloseTo(792)
    expect(layout.image.width).toBeCloseTo(1584)
  })

  it('applies the page scale on top of the fit', () => {
    const a = asset('a', { width: 1000, height: 1000 })
    const fitted = layoutPage(letter, a, page('p', 'a'))
    const half = layoutPage(letter, a, page('p', 'a', { scale: 0.5 }))
    expect(half.image.width).toBeCloseTo(fitted.image.width / 2)
  })

  it('reports the printed resolution', () => {
    // 2550px across 8.5in is 300 dpi.
    const layout = layoutPage(letter, asset('a', { width: 2550, height: 3300 }), page('p', 'a'))
    expect(layout.dpi).toBeCloseTo(300)
  })

  it('shrinks the printable area by the margin and never lets it vanish', () => {
    const withMargin = layoutPage(
      settings({ size: 'letter', margin: 72 }),
      asset('a'),
      page('p', 'a'),
    )
    expect(withMargin.content).toEqual({ x: 72, y: 72, width: 648, height: 468 })
    const huge = layoutPage(
      settings({ size: 'letter', margin: 10_000 }),
      asset('a'),
      page('p', 'a'),
    )
    expect(huge.content.width).toBeGreaterThan(0)
    expect(huge.content.height).toBeGreaterThan(0)
  })

  it('picks landscape for auto orientation from the turned image', () => {
    const wide = asset('a', { width: 300, height: 200 })
    expect(isLandscape(wide, { turns: 0 })).toBe(true)
    expect(isLandscape(wide, { turns: 1 })).toBe(false)
    expect(isLandscape(asset('s', { width: 200, height: 200 }), { turns: 0 })).toBe(false)
  })
})
