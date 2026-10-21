import type { Point, Quad } from './perspective'

/**
 * The crop editor shows the image as the page shows it: turned by the page's
 * quarter turns. Corners are stored in the upright image (fractions, top-left
 * first, clockwise), so the editor converts on the way in and out. Order
 * follows the view: the stored top-left of a page turned once is shown at the
 * top right, so it's the second corner on screen.
 */

/** An upright-image point as seen after `turns` clockwise quarter turns. */
export const toView = (p: Point, turns: number): Point => {
  switch (((turns % 4) + 4) % 4) {
    case 1:
      return { x: 1 - p.y, y: p.x }
    case 2:
      return { x: 1 - p.x, y: 1 - p.y }
    case 3:
      return { x: p.y, y: 1 - p.x }
    default:
      return { x: p.x, y: p.y }
  }
}

/** The inverse of `toView`. */
export const fromView = (p: Point, turns: number): Point => toView(p, 4 - (((turns % 4) + 4) % 4))

const four = <T>(f: (i: number) => T): [T, T, T, T] => [f(0), f(1), f(2), f(3)]

/** Stored corners → the corners on screen, in screen order (top-left first). */
export const quadToView = (quad: Quad, turns: number): Quad => {
  const t = ((turns % 4) + 4) % 4
  return four((i) => toView(quad[(i + 4 - t) % 4] ?? quad[0], t))
}

/** Corners on screen → stored corners, in stored order. */
export const quadFromView = (quad: Quad, turns: number): Quad => {
  const t = ((turns % 4) + 4) % 4
  return four((j) => fromView(quad[(j + t) % 4] ?? quad[0], t))
}

/** The edges on screen: edge i runs from corner i to corner i + 1. */
export const EDGE_NAMES = ['Top', 'Right', 'Bottom', 'Left'] as const

export const edgeMidpoint = (quad: Quad, edge: number): Point => {
  const a = quad[edge % 4] ?? quad[0]
  const b = quad[(edge + 1) % 4] ?? quad[0]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Moves one edge's two corners together, straight out or in: `by` (fractions
 * of the view) is projected onto the edge's perpendicular, measured in
 * pixels of a `width` × `height` view so "perpendicular" is what you see. The
 * move is shortened so neither corner leaves the image, keeping the edge's
 * direction. Returns the quad unchanged if `by` runs along the edge.
 */
export const moveEdge = (
  quad: Quad,
  edge: number,
  by: Point,
  width: number,
  height: number,
): Quad => {
  const i = edge % 4
  const j = (edge + 1) % 4
  const a = quad[i] ?? quad[0]
  const b = quad[j] ?? quad[0]
  const ex = (b.x - a.x) * width
  const ey = (b.y - a.y) * height
  const length = Math.hypot(ex, ey)
  if (length === 0) return quad
  const nx = -ey / length
  const ny = ex / length
  let t = by.x * width * nx + by.y * height * ny
  if (Math.abs(t) < 1e-9) return quad
  // Shorten t so both corners stay inside [0, width] × [0, height].
  for (const p of [a, b]) {
    for (const [value, normal, size] of [
      [p.x * width, nx, width],
      [p.y * height, ny, height],
    ] as const) {
      if (normal === 0) continue
      const limit = ((t * normal > 0 ? size : 0) - value) / normal
      if (t > 0 ? limit < t : limit > t) t = limit
    }
  }
  const shift = { x: (t * nx) / width, y: (t * ny) / height }
  const next: [Point, Point, Point, Point] = [...quad]
  next[i] = { x: a.x + shift.x, y: a.y + shift.y }
  next[j] = { x: b.x + shift.x, y: b.y + shift.y }
  return next
}
