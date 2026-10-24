// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findPaper } from './paper'
import type { Quad } from './perspective'

const FIXTURES = join(import.meta.dirname, '../../tests/fixtures')
const THUMB_EDGE = 720

/** Pillow decodes the photos (CI installs it); without it those cases are skipped. */
const hasPillow = (() => {
  try {
    execFileSync('python3', ['-I', '-c', 'import PIL'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** A fixture's RGBA at thumbnail size: the app looks for paper in the thumbnail. */
const decode = (name: string) => {
  const script = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGBA")
im.thumbnail((${THUMB_EDGE}, ${THUMB_EDGE}))
sys.stdout.write(f"{im.width} {im.height}\\n")
sys.stdout.flush()
sys.stdout.buffer.write(im.tobytes())
`
  const out = execFileSync('python3', ['-I', '-c', script, join(FIXTURES, name)], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const newline = out.indexOf(10)
  const [width = 0, height = 0] = out.subarray(0, newline).toString().split(' ').map(Number)
  return { data: new Uint8ClampedArray(out.subarray(newline + 1)), width, height }
}

/** The furthest any corner is from the truth, along x or y, as a fraction of the photo. */
const worstCorner = (found: Quad, truth: readonly (readonly [number, number])[]) =>
  Math.max(
    ...found.map((p, i) => {
      const [x = 0, y = 0] = truth[i] ?? []
      return Math.max(Math.abs(p.x - x), Math.abs(p.y - y))
    }),
  )

/**
 * Light paper with dark lines of "text" on a darker, noisy table, drawn from
 * `corners` (fractions). Pixels are tested against the quad, so it's sharp.
 */
const synthetic = (
  corners: [number, number][] | null,
  { width = 480, height = 640, table = 70 } = {},
) => {
  const data = new Uint8ClampedArray(width * height * 4)
  let seed = 3
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const pts = (corners ?? []).map(([x, y]) => [x * width, y * height] as const)
  const inside = (x: number, y: number) =>
    corners !== null &&
    pts.every(([ax, ay], i) => {
      const [bx, by] = pts[(i + 1) % 4] ?? [0, 0]
      return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0
    })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paper = inside(x + 0.5, y + 0.5)
      const text = paper && y % 24 < 6 && x % 50 < 38 && inside(x - 40, y) && inside(x + 40, y)
      const v = (text ? 60 : paper ? 232 : table) + Math.round((rand() - 0.5) * 16)
      data.set([v, v - 4, v - 12, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

describe('findPaper', () => {
  it('finds a sheet on a table', () => {
    const corners: [number, number][] = [
      [0.2, 0.15],
      [0.82, 0.1],
      [0.88, 0.86],
      [0.12, 0.9],
    ]
    const { data, width, height } = synthetic(corners)
    const guess = findPaper(data, width, height)
    expect(guess).not.toBeNull()
    if (guess) expect(worstCorner(guess.corners, corners)).toBeLessThan(0.01)
  })

  it('suggests nothing for a bare table or a blank page', () => {
    for (const table of [70, 232]) {
      const { data, width, height } = synthetic(null, { table })
      expect(findPaper(data, width, height)).toBeNull()
    }
  })

  it('suggests nothing when the sheet fills the frame', () => {
    const { data, width, height } = synthetic([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ])
    expect(findPaper(data, width, height)).toBeNull()
  })
})

describe.skipIf(!hasPillow)('findPaper on photos', () => {
  const truth = JSON.parse(readFileSync(join(FIXTURES, 'paper-corners.json'), 'utf8')) as Record<
    string,
    [number, number][]
  >

  it.each(Object.keys(truth))('finds the corners of %s to within 2%', (name) => {
    const { data, width, height } = decode(name)
    const guess = findPaper(data, width, height)
    expect(guess).not.toBeNull()
    if (guess) expect(worstCorner(guess.corners, truth[name] ?? [])).toBeLessThanOrEqual(0.02)
  })

  it('finds a sheet turned 4° whose corners touch the frame', () => {
    // As scripts/verify.mjs works them out: 900 × 1200 turned onto 982 × 1260.
    const { data, width, height } = decode('doc-skewed-4deg.jpg')
    const guess = findPaper(data, width, height)
    expect(guess).not.toBeNull()
    if (guess)
      expect(
        worstCorner(guess.corners, [
          [0.0855, 0.0001],
          [0.9998, 0.0499],
          [0.9145, 0.9999],
          [0.0002, 0.9501],
        ]),
      ).toBeLessThanOrEqual(0.02)
  })

  it.each(['doc-photo.jpg', 'scan-letter-300dpi.jpg', 'quad-portrait.jpg', 'gradient.png'])(
    'suggests nothing when there is no sheet to find: %s',
    (name) => {
      const { data, width, height } = decode(name)
      expect(findPaper(data, width, height)).toBeNull()
    },
  )
})
