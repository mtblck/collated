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

describe('filterEncoding', () => {
  it('stores greyscale as JPEG and black and white losslessly', () => {
    expect(filterEncoding('grey').format).toBe('jpeg')
    expect(filterEncoding('bw').format).toBe('png')
  })
})
