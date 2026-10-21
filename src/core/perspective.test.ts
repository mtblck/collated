// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { apply, homography, isConvex, toPixels, warp, warpSize, type Quad } from './perspective'

const unit: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

describe('homography', () => {
  it('maps each corner exactly and is the identity for identical quads', () => {
    const to: Quad = [
      { x: 10, y: 20 },
      { x: 300, y: 5 },
      { x: 320, y: 410 },
      { x: -4, y: 390 },
    ]
    const h = homography(unit, to)
    unit.forEach((p, i) => {
      const q = apply(h, p)
      expect(q.x).toBeCloseTo(to[i]?.x ?? NaN, 6)
      expect(q.y).toBeCloseTo(to[i]?.y ?? NaN, 6)
    })
    const id = homography(unit, unit)
    expect(apply(id, { x: 0.3, y: 0.7 }).x).toBeCloseTo(0.3, 9)
  })

  it('refuses degenerate corners', () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ]
    expect(() => homography(unit, line)).toThrow(/usable shape/)
  })
})

describe('isConvex', () => {
  it('accepts a sheet of paper and rejects crossed or collapsed corners', () => {
    expect(isConvex(unit)).toBe(true)
    const bowtie: Quad = [unit[0], unit[2], unit[1], unit[3]]
    expect(isConvex(bowtie)).toBe(false)
    expect(isConvex([unit[0], unit[0], unit[2], unit[3]])).toBe(false)
  })
})

describe('warpSize', () => {
  it('averages opposite edges', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 110, y: 200 },
      { x: -10, y: 200 },
    ]
    expect(warpSize(quad)).toEqual({ width: 110, height: 200 })
  })
})

describe('warp', () => {
  it('recovers a rectangle photographed as a trapezoid', () => {
    // Source: a 200 × 200 image whose "paper" is a trapezoid, red on the
    // left half and blue on the right, on a black table.
    const W = 200
    const H = 200
    const paper: Quad = [
      { x: 40, y: 20 },
      { x: 160, y: 20 },
      { x: 190, y: 180 },
      { x: 10, y: 180 },
    ]
    const inside = (x: number, y: number) => {
      const t = (y - 20) / 160
      const left = 40 - 30 * t
      const right = 160 + 30 * t
      return y >= 20 && y <= 180 && x >= left && x <= right ? (x - left) / (right - left) : -1
    }
    const src = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = inside(x + 0.5, y + 0.5)
        const px = u < 0 ? [0, 0, 0] : u < 0.5 ? [220, 30, 30] : [30, 60, 220]
        src.set([...px, 255], (y * W + x) * 4)
      }
    }
    const out = warp(src, W, H, paper, 150, 160)
    const at = (x: number, y: number) =>
      Array.from(out.subarray((y * 150 + x) * 4, (y * 150 + x) * 4 + 3))
    // No table (black) anywhere inside a 3 px border, red left, blue right.
    let black = 0
    for (let y = 3; y < 157; y++)
      for (let x = 3; x < 147; x++) if (Math.max(...at(x, y)) < 40) black += 1
    expect(black).toBe(0)
    expect(at(20, 80)).toEqual([220, 30, 30])
    expect(at(130, 80)).toEqual([30, 60, 220])
    // The colour boundary runs straight down the middle at every height.
    for (const y of [5, 80, 155]) {
      expect(at(72, y)[0]).toBeGreaterThan(150)
      expect(at(78, y)[2]).toBeGreaterThan(150)
    }
  })

  it('scales normalised corners to pixels', () => {
    expect(toPixels(unit, 300, 200)[2]).toEqual({ x: 300, y: 200 })
  })
})
