// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BLANK_INK, blankness } from './blank'

/**
 * A synthetic scanned sheet at thumbnail size (A4-ish, 510 × 720): off-white
 * paper with a little noise and a gentle lighting gradient, painted on by
 * the test. `ink` draws one mark: a grey level at (x, y).
 */
const sheet = (
  paint: (ink: (x: number, y: number, v?: number) => void, width: number, height: number) => void,
  { width = 510, height = 720, seed = 7, paper = [236, 234, 228] } = {},
) => {
  const data = new Uint8ClampedArray(width * height * 4)
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shade = Math.round((x / width) * -12 + (rand() - 0.5) * 10)
      data.set(
        [(paper[0] ?? 0) + shade, (paper[1] ?? 0) + shade, (paper[2] ?? 0) + shade, 255],
        (y * width + x) * 4,
      )
    }
  }
  const ink = (x: number, y: number, v = 40) => {
    const px = Math.round(x)
    const py = Math.round(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return
    data.set([v, v, v], (py * width + px) * 4)
  }
  paint(ink, width, height)
  return { data, width, height }
}

/** Letter-sized rings (5 × 7, one-pixel strokes), like small print in a thumbnail. */
const text = (
  ink: (x: number, y: number, v?: number) => void,
  {
    x,
    y,
    letters,
    v = 40,
    mirror = 0,
  }: { x: number; y: number; letters: number; v?: number; mirror?: number },
) => {
  for (let l = 0; l < letters; l++) {
    // A space every sixth letter.
    if (l % 6 === 5) continue
    const lx = x + l * 7
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        if (dy === 0 || dy === 6 || dx === 0 || dx === 4) {
          ink(mirror ? mirror - (lx + dx) : lx + dx, y + dy, v)
        }
      }
    }
  }
}

const disc = (
  ink: (x: number, y: number, v?: number) => void,
  cx: number,
  cy: number,
  r: number,
) => {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) ink(cx + x, cy + y, 25)
  }
}

const score = (page: ReturnType<typeof sheet>) => blankness(page.data, page.width, page.height)

describe('blankness', () => {
  it('flags an empty sheet', () => {
    const result = score(sheet(() => undefined))
    expect(result.blank).toBe(true)
    expect(result.ink).toBe(0)
  })

  it('flags a sheet with faint bleed-through from the other side', () => {
    const result = score(
      sheet((ink, width) => {
        for (let row = 0; row < 24; row++) {
          text(ink, { x: 60, y: 80 + row * 22, letters: 55, v: 196, mirror: width })
        }
      }),
    )
    expect(result.blank).toBe(true)
  })

  it('flags a sheet with punch holes, specks of dust and a scanner shadow at the edge', () => {
    const result = score(
      sheet((ink, width, height) => {
        // Two-hole punch, 6 mm holes 12 mm in from the left edge of A4.
        disc(ink, width * 0.057, height * 0.35, 7)
        disc(ink, width * 0.057, height * 0.65, 7)
        // Dust.
        for (const [x, y] of [
          [140, 200],
          [301, 455],
          [222, 610],
          [400, 90],
        ] as const) {
          ink(x, y)
          ink(x + 1, y)
        }
        // The lid's shadow down the right edge.
        for (let y = 0; y < height; y++) {
          for (let x = width - 12; x < width; x++) ink(x, y, 70)
        }
      }),
    )
    expect(result.blank).toBe(true)
  })

  it('flags a sheet with three punch holes from a ring binder', () => {
    const result = score(
      sheet((ink, width, height) => {
        for (const at of [0.25, 0.5, 0.75]) disc(ink, width * 0.94, height * at, 8)
      }),
    )
    expect(result.blank).toBe(true)
  })

  it('keeps a sheet with a single short line of text', () => {
    const result = score(
      sheet((ink) => {
        text(ink, { x: 180, y: 360, letters: 24 })
      }),
    )
    expect(result.blank).toBe(false)
    expect(result.ink).toBeGreaterThan(BLANK_INK)
  })

  it('keeps a sheet with only a signature', () => {
    const result = score(
      sheet((ink) => {
        for (let x = 0; x < 90; x++) {
          const y = 600 + Math.round(Math.sin(x / 6) * 8)
          ink(300 + x, y)
          ink(300 + x, y + 1)
        }
      }),
    )
    expect(result.blank).toBe(false)
  })

  it('keeps a sheet with one word on it, even beside punch holes', () => {
    const result = score(
      sheet((ink, width, height) => {
        disc(ink, width * 0.057, height * 0.35, 7)
        disc(ink, width * 0.057, height * 0.65, 7)
        text(ink, { x: 230, y: 100, letters: 5 })
      }),
    )
    expect(result.blank).toBe(false)
  })

  it('keeps a page of text', () => {
    const result = score(
      sheet((ink) => {
        for (let row = 0; row < 24; row++) text(ink, { x: 60, y: 80 + row * 22, letters: 55 })
      }),
    )
    expect(result.blank).toBe(false)
    expect(result.ink).toBeGreaterThan(0.02)
  })

  it('keeps dark or colourful sheets with nothing printed on them', () => {
    expect(score(sheet(() => undefined, { paper: [60, 60, 64] })).blank).toBe(false)
    expect(score(sheet(() => undefined, { paper: [40, 110, 200] })).blank).toBe(false)
  })

  it('keeps a photo', () => {
    const result = score(
      sheet((ink, width, height) => {
        let s = 3
        const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const v = 128 + Math.sin(x / 9) * 60 + Math.cos(y / 13) * 50 + (rand() - 0.5) * 40
            ink(x, y, v)
          }
        }
      }),
    )
    expect(result.blank).toBe(false)
  })
})
