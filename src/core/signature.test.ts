import { describe, expect, it } from 'vitest'
import { inkBounds, inkShare, penWidth, photoToInk } from './signature'

/** A w × h RGBA image filled by `at`. */
const image = (w: number, h: number, at: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4)
  return data
}

describe('signatures, pixel side (#111)', () => {
  it('finds the ink, padded inside the image, and nothing on a clear pad', () => {
    const data = image(20, 10, (x, y) =>
      x >= 5 && x <= 8 && y === 4 ? [0, 0, 0, 255] : [0, 0, 0, 0],
    )
    expect(inkBounds(data, 20, 10)).toEqual({ x: 5, y: 4, width: 4, height: 1 })
    expect(inkBounds(data, 20, 10, 6)).toEqual({ x: 0, y: 0, width: 15, height: 10 })
    expect(inkBounds(new Uint8ClampedArray(40), 10, 1)).toBeNull()
  })

  it('turns paper transparent and keeps the pen, under uneven light', () => {
    // Paper brightening left to right, with a dark blue line across the middle.
    const w = 64
    const h = 32
    const data = image(w, h, (x, y) => {
      const paper = 150 + x * 1.5
      return y >= 15 && y <= 16 ? [20, 30, 120, 255] : [paper, paper, paper, 255]
    })
    photoToInk(data, w, h)
    const alpha = (x: number, y: number) => data[(y * w + x) * 4 + 3]
    expect(alpha(5, 2)).toBe(0)
    expect(alpha(60, 28)).toBe(0)
    expect(alpha(30, 15)).toBe(255)
    // Still blue, a little darker.
    expect([...data.subarray((15 * w + 30) * 4, (15 * w + 30) * 4 + 3)]).toEqual([12, 18, 72])
    expect(inkShare(data)).toBeCloseTo((2 * w) / (w * h), 2)
  })

  it('thins the line with a light touch only for pens that report pressure', () => {
    expect(penWidth(4, 0.5)).toBe(4)
    expect(penWidth(4, 0)).toBe(4)
    expect(penWidth(4, 0.1)).toBeLessThan(penWidth(4, 0.9))
  })
})
