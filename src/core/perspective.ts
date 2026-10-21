/**
 * Perspective correction: map a quadrilateral in a photo (four corners of a
 * sheet of paper) onto a rectangle. Pure math on raw RGBA, so the preview
 * (thumbnail, in the page) and the export (full size, in the worker) run the
 * same code.
 */

export interface Point {
  x: number
  y: number
}

/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [Point, Point, Point, Point]

/** The whole image, in normalised corners. */
export const FULL_IMAGE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

export const isWholeImage = (quad: Quad) =>
  quad.every((p, i) => p.x === (FULL_IMAGE[i] ?? p).x && p.y === (FULL_IMAGE[i] ?? p).y)

/** A 3×3 projective transform, row-major, with h[8] = 1. */
export type Homography = readonly number[]

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * The rectangle a quad becomes: each side the mean of the two edges it
 * replaces. Good for paper photographed at moderate angles, which is what this
 * is for; it can't recover the true aspect of a steeply foreshortened sheet.
 */
export const warpSize = (quad: Quad) => ({
  width: Math.max(1, Math.round((distance(quad[0], quad[1]) + distance(quad[3], quad[2])) / 2)),
  height: Math.max(1, Math.round((distance(quad[0], quad[3]) + distance(quad[1], quad[2])) / 2)),
})

/**
 * Solves the n×n system A·x = b (A flat, row-major) by Gaussian elimination
 * with partial pivoting. Works on copies.
 */
const solve = (matrix: Float64Array, rhs: Float64Array, n: number): Float64Array => {
  const a = matrix.slice()
  const b = rhs.slice()
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row * n + col] ?? 0) > Math.abs(a[pivot * n + col] ?? 0)) pivot = row
    }
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = a[col * n + k] ?? 0
        a[col * n + k] = a[pivot * n + k] ?? 0
        a[pivot * n + k] = t
      }
      const t = b[col] ?? 0
      b[col] = b[pivot] ?? 0
      b[pivot] = t
    }
    const p = a[col * n + col] ?? 0
    if (Math.abs(p) < 1e-12) throw new Error('Those corners don’t make a usable shape.')
    for (let row = col + 1; row < n; row++) {
      const f = (a[row * n + col] ?? 0) / p
      for (let k = col; k < n; k++)
        a[row * n + k] = (a[row * n + k] ?? 0) - f * (a[col * n + k] ?? 0)
      b[row] = (b[row] ?? 0) - f * (b[col] ?? 0)
    }
  }
  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row] ?? 0
    for (let k = row + 1; k < n; k++) sum -= (a[row * n + k] ?? 0) * (x[k] ?? 0)
    x[row] = sum / (a[row * n + row] ?? 1)
  }
  return x
}

/** The homography taking each `from` point to its `to` point (four pairs). */
export const homography = (from: Quad, to: Quad): Homography => {
  const a = new Float64Array(64)
  const b = new Float64Array(8)
  from.forEach(({ x, y }, i) => {
    const { x: u, y: v } = to[i] ?? { x: 0, y: 0 }
    a.set([x, y, 1, 0, 0, 0, -u * x, -u * y], i * 16)
    a.set([0, 0, 0, x, y, 1, -v * x, -v * y], i * 16 + 8)
    b[i * 2] = u
    b[i * 2 + 1] = v
  })
  return [...solve(a, b, 8), 1]
}

export const apply = (h: Homography, p: Point): Point => {
  const w = (h[6] ?? 0) * p.x + (h[7] ?? 0) * p.y + (h[8] ?? 1)
  return {
    x: ((h[0] ?? 0) * p.x + (h[1] ?? 0) * p.y + (h[2] ?? 0)) / w,
    y: ((h[3] ?? 0) * p.x + (h[4] ?? 0) * p.y + (h[5] ?? 0)) / w,
  }
}

/** True when the four corners go round in order without crossing (a convex quad). */
export const isConvex = (quad: Quad) => {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i % 4] ?? quad[0]
    const b = quad[(i + 1) % 4] ?? quad[0]
    const c = quad[(i + 2) % 4] ?? quad[0]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

/**
 * Warps the `quad` region of `source` (pixels) to an `outWidth × outHeight`
 * rectangle, sampling bilinearly. Each output pixel's centre is mapped back
 * into the source (inverse mapping), so there are no holes.
 */
export const warp = (
  source: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  outWidth: number,
  outHeight: number,
): Uint8ClampedArray<ArrayBuffer> => {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ]
  const h = homography(rect, quad)
  const out = new Uint8ClampedArray(outWidth * outHeight * 4)
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h
  for (let y = 0; y < outHeight; y++) {
    const cy = y + 0.5
    for (let x = 0; x < outWidth; x++) {
      const cx = x + 0.5
      const w = h6 * cx + h7 * cy + 1
      // Source coordinates of this pixel's centre, as a pixel-centre position.
      const sx = Math.min(width - 1, Math.max(0, (h0 * cx + h1 * cy + h2) / w - 0.5))
      const sy = Math.min(height - 1, Math.max(0, (h3 * cx + h4 * cy + h5) / w - 0.5))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(width - 1, x0 + 1)
      const y1 = Math.min(height - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * width + x0) * 4
      const i10 = (y0 * width + x1) * 4
      const i01 = (y1 * width + x0) * 4
      const i11 = (y1 * width + x1) * 4
      const o = (y * outWidth + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = (source[i00 + c] ?? 0) * (1 - fx) + (source[i10 + c] ?? 0) * fx
        const bottom = (source[i01 + c] ?? 0) * (1 - fx) + (source[i11 + c] ?? 0) * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
    }
  }
  return out
}

/** Corners as fractions of the image (0–1), scaled to a pixel size. */
export const toPixels = (corners: Quad, width: number, height: number): Quad => {
  const [a, b, c, d] = corners
  const px = (p: Point) => ({ x: p.x * width, y: p.y * height })
  return [px(a), px(b), px(c), px(d)]
}
