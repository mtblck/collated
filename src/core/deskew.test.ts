// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { estimateSkew } from './deskew'

/**
 * A synthetic page: grey-white paper with lines of dark "words", tilted
 * clockwise by `skew` degrees (y down), plus a little noise.
 */
const page = (skew: number, { width = 600, height = 800, lines = true, seed = 1 } = {}) => {
  const data = new Uint8ClampedArray(width * height * 4)
  const r = (skew * Math.PI) / 180
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Un-rotate to find where this pixel sits on the level page.
      const cx = x - width / 2
      const cy = y - height / 2
      const ux = cx * Math.cos(r) + cy * Math.sin(r) + width / 2
      const uy = -cx * Math.sin(r) + cy * Math.cos(r) + height / 2
      const row = Math.floor((uy - 80) / 28)
      const inLine =
        lines && uy > 80 && uy < height - 80 && (uy - 80) % 28 < 9 && ux > 70 && ux < width - 70
      const word = Math.floor(ux / 37 + row * 3) % 5 !== 0
      const ink = inLine && word
      const v = (ink ? 60 : 230) + Math.round((rand() - 0.5) * 20)
      data.set([v, v, v - 8, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

describe('estimateSkew', () => {
  it.each([0, 1.5, -3.5, 7, -12])('levels a page tilted %s° to within 0.3°', (skew) => {
    const { data, width, height } = page(skew)
    const result = estimateSkew(data, width, height)
    expect(result).not.toBeNull()
    expect(Math.abs((result?.angle ?? 99) + skew)).toBeLessThanOrEqual(0.3)
  })

  it('straightens a page on its side by its columns of text', () => {
    // Transpose a tilted page: its lines now run vertically.
    const { data, width, height } = page(4, { width: 500, height: 500 })
    const t = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++)
        t.set(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4), (x * height + y) * 4)
    }
    const result = estimateSkew(t, height, width)
    // Transposing mirrors the tilt, so the correction flips sign.
    expect(Math.abs((result?.angle ?? 99) - 4)).toBeLessThanOrEqual(0.3)
  })

  it('declines to guess on a blank page', () => {
    const { data, width, height } = page(0, { lines: false })
    expect(estimateSkew(data, width, height)).toBeNull()
  })
})
