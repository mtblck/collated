// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyFilter, filterEncoding } from './filters'

const image = (width: number, height: number, pixel: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([...pixel(x, y), 255], (y * width + x) * 4)
  }
  return data
}
const at = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))

describe('applyFilter', () => {
  it('leaves the original untouched', () => {
    const data = image(4, 4, () => [10, 200, 30])
    const before = data.slice()
    applyFilter(data, 4, 4, 'original')
    expect(data).toEqual(before)
  })

  it('converts to greyscale by luma, keeping alpha', () => {
    const data = image(2, 1, (x) => (x === 0 ? [255, 0, 0] : [0, 0, 255]))
    applyFilter(data, 2, 1, 'grey')
    expect(at(data, 2, 0, 0)).toEqual([76, 76, 76, 255])
    expect(at(data, 2, 1, 0)).toEqual([29, 29, 29, 255])
  })

  it('keeps dark text black and paper white under a lighting gradient', () => {
    // Paper fades from bright (240) on the left to shadowed (110) on the
    // right; "text" pixels are 60 darker than the paper around them. A single
    // global threshold can't separate both ends; the adaptive one does.
    const W = 160
    const H = 40
    const paper = (x: number) => 240 - (130 * x) / W
    const isText = (x: number, y: number) => y >= 18 && y <= 21 && x % 10 < 6
    const data = image(W, H, (x, y) => {
      const v = paper(x) - (isText(x, y) ? 60 : 0)
      return [v, v, v]
    })
    applyFilter(data, W, H, 'bw')
    let wrong = 0
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = at(data, W, x, y)[0]
        expect(v === 0 || v === 255).toBe(true)
        if ((v === 0) !== isText(x, y)) wrong += 1
      }
    }
    expect(wrong / (W * H)).toBeLessThan(0.01)
    // Text in the shadowed right half is darker paper than the left's ink
    // would be under a global cut — and still comes out as black text.
    expect(at(data, W, 150, 19)[0]).toBe(0)
    expect(at(data, W, 155, 5)[0]).toBe(255)
  })

  it('turns a flat page fully white', () => {
    const data = image(30, 30, () => [200, 200, 200])
    applyFilter(data, 30, 30, 'bw')
    expect(new Set(Array.from(data))).toEqual(new Set([255]))
  })
})

describe('enhance', () => {
  const hue = ([r, g, b]: number[]) => {
    const [R, G, B] = [r ?? 0, g ?? 0, b ?? 0]
    const max = Math.max(R, G, B)
    const d = max - Math.min(R, G, B)
    const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    return (h * 60 + 360) % 360
  }

  it('whitens unevenly lit, warm paper and keeps the ink colour', () => {
    // Warm paper (a yellowish cast) fading from bright on the left to deep
    // shadow on the right, with red and blue "ink" strokes across it whose
    // brightness follows the same lighting.
    const W = 240
    const H = 120
    const light = (x: number) => 1 - (0.55 * x) / W
    const paper = [235, 220, 190]
    const red = [190, 40, 40]
    const blue = [40, 60, 170]
    const ink = (x: number, y: number) =>
      x % 12 < 3 && y >= 30 && y < 50 ? red : x % 12 < 3 && y >= 70 && y < 90 ? blue : null
    const data = image(W, H, (x, y) => (ink(x, y) ?? paper).map((v) => v * light(x)))
    applyFilter(data, W, H, 'enhance')

    // Paper: white and even across the whole gradient, cast gone.
    for (let y = 0; y < H; y += 3) {
      for (let x = 0; x < W; x += 3) {
        if (ink(x, y) || (y >= 26 && y < 94)) continue
        const p = at(data, W, x, y)
        expect(Math.min(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0)).toBeGreaterThanOrEqual(245)
      }
    }
    // Ink: the same hue on the bright and the shadowed side, and still dark.
    for (const [y, colour] of [
      [40, red],
      [80, blue],
    ] as const) {
      // Divided by the paper, the ink's expected colour is ink / paper.
      const want = hue(colour.map((v, k) => v / (paper[k] ?? 1)))
      for (const x of [13, 121, 229]) {
        const p = at(data, W, x, y)
        expect(Math.abs(hue(p) - want)).toBeLessThan(8)
        expect(
          Math.max(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0) - Math.min(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0),
        ).toBeGreaterThan(100)
      }
      // Left and right strokes come out alike although one is half as bright.
      const l = at(data, W, 13, y)
      const r = at(data, W, 229, y)
      for (let k = 0; k < 3; k++) expect(Math.abs((l[k] ?? 0) - (r[k] ?? 0))).toBeLessThan(20)
    }
    expect(at(data, W, 5, 5)[3]).toBe(255)
  })

  it('treats a thumbnail and the full size alike', () => {
    const scene = (s: number) =>
      image(80 * s, 60 * s, (x, y) => {
        const l = 1 - (0.4 * y) / (60 * s)
        const stamp = Math.hypot(x / s - 55, y / s - 30) < 8
        return (stamp ? [200, 30, 60] : [230, 225, 215]).map((v) => v * l)
      })
    const small = scene(1)
    const big = scene(4)
    applyFilter(small, 80, 60, 'enhance')
    applyFilter(big, 320, 240, 'enhance')
    let off = 0
    for (let y = 0; y < 60; y++) {
      for (let x = 0; x < 80; x++) {
        const a = at(small, 80, x, y)
        const b = at(big, 320, x * 4 + 2, y * 4 + 2)
        if (a.some((v, k) => Math.abs(v - (b[k] ?? 0)) > 24)) off += 1
      }
    }
    expect(off / (80 * 60)).toBeLessThan(0.03)
  })

  it('does not blow a dark photo on the page out to white', () => {
    // A dark photo covering the middle half of a page: far wider than the
    // paper estimate's reach, so its middle has no paper nearby.
    const W = 240
    const H = 320
    const inPhoto = (x: number, y: number) => x >= 60 && x < 180 && y >= 80 && y < 240
    const data = image(W, H, (x, y) => (inPhoto(x, y) ? [70, 55, 40] : [230, 230, 230]))
    applyFilter(data, W, H, 'enhance')
    const p = at(data, W, 120, 160)
    expect(p[0]).toBeLessThan(160)
    expect(p[0]).toBeGreaterThan((p[2] ?? 0) + 20)
    expect(at(data, W, 10, 10)).toEqual([255, 255, 255, 255])
  })
})

describe('filterEncoding', () => {
  it('stores greyscale and enhanced as JPEG and black and white losslessly', () => {
    expect(filterEncoding('grey').format).toBe('jpeg')
    expect(filterEncoding('enhance').format).toBe('jpeg')
    expect(filterEncoding('bw').format).toBe('png')
  })
})
