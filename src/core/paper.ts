import { isConvex, type Point, type Quad } from './perspective'

/**
 * Finds a sheet of paper in a photo: the four corners the crop editor would
 * otherwise need dragging into place. No OpenCV (~3.75 MB): a small detector
 * of our own on a downscaled copy, in four steps.
 *
 * 1. Edges: Sobel on each colour channel (so a sheet on a table of similar
 *    brightness but different colour still shows), thinned to one pixel.
 * 2. Lines: a Hough transform, each edge pixel voting only near its own
 *    gradient direction, so text and wood grain stay cheap.
 * 3. Quads: every pair of near-horizontal lines with every pair of
 *    near-vertical ones. A side scores by how much of its length has an
 *    edge across it; the biggest quad whose weakest side is still well
 *    supported wins.
 * 4. Refinement: each side is refitted to its edge at subpixel precision.
 *
 * Returns null when nothing is clear enough to suggest, including when the
 * paper already fills the frame (a scan).
 */

export interface PaperGuess {
  /** Upright corners as fractions (0–1): top-left, top-right, bottom-right, bottom-left. */
  corners: Quad
  /** The weakest side's share of its length that has an edge along it (0–1). */
  confidence: number
}

/** Below this, the weakest side is mostly guesswork. */
export const MIN_CONFIDENCE = 0.6

/** The working size's long side, in pixels. */
const WORK_SIZE = 320
/** Smallest sheet worth suggesting, as a share of the photo. */
const MIN_AREA = 0.12
/** An edge step this strong (grey levels per pixel, after the blur) counts. */
const EDGE_MIN = 3
/** Lines kept from the Hough transform in each of the two directions. */
const LINES_PER_DIRECTION = 14
/** Opposite sides of a photographed sheet are within this many degrees of parallel. */
const MAX_SPREAD = 40

interface Line {
  /** Unit normal and offset: points p with p·n = rho lie on the line. */
  nx: number
  ny: number
  rho: number
  votes: number
}

interface Edges {
  width: number
  height: number
  gx: Float32Array
  gy: Float32Array
  /** Thinned edge pixels (1) for the Hough transform. */
  thin: Uint8Array
}

/** Box-averages RGBA down to at most WORK_SIZE on the long side; three float planes. */
const downscale = (rgba: Uint8ClampedArray, width: number, height: number) => {
  const factor = Math.max(1, Math.max(width, height) / WORK_SIZE)
  const w = Math.max(1, Math.round(width / factor))
  const h = Math.max(1, Math.round(height / factor))
  const planes = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w))
      let r = 0
      let g = 0
      let b = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * width + sx) * 4
          r += rgba[i] ?? 0
          g += rgba[i + 1] ?? 0
          b += rgba[i + 2] ?? 0
        }
      }
      const n = (y1 - y0) * (x1 - x0)
      const o = y * w + x
      ;(planes[0] as Float32Array)[o] = r / n
      ;(planes[1] as Float32Array)[o] = g / n
      ;(planes[2] as Float32Array)[o] = b / n
    }
  }
  return { w, h, planes }
}

/** A separable [1 4 6 4 1] / 16 blur, edges clamped. */
const blur = (plane: Float32Array, w: number, h: number) => {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -2; j <= 2; j++) {
        const xx = Math.min(w - 1, Math.max(0, x + j))
        s += (k[j + 2] ?? 0) * (plane[y * w + xx] ?? 0)
      }
      tmp[y * w + x] = s
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -2; j <= 2; j++) {
        const yy = Math.min(h - 1, Math.max(0, y + j))
        s += (k[j + 2] ?? 0) * (tmp[yy * w + x] ?? 0)
      }
      out[y * w + x] = s
    }
  }
  return out
}

/**
 * Per pixel, the Sobel gradient of whichever channel changes most, in grey
 * levels per pixel; then non-maximum suppression along it, Canny-style.
 */
export const edges = (rgba: Uint8ClampedArray, width: number, height: number): Edges => {
  const { w, h, planes } = downscale(rgba, width, height)
  const blurred = planes.map((p) => blur(p, w, h))
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const mag = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      let best = -1
      for (const p of blurred) {
        const at = (dx: number, dy: number) => p[i + dy * w + dx] ?? 0
        const sx =
          (at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1)) / 8
        const sy =
          (at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1)) / 8
        const m = sx * sx + sy * sy
        if (m > best) {
          best = m
          gx[i] = sx
          gy[i] = sy
        }
      }
      mag[i] = Math.sqrt(best)
    }
  }
  const thin = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const m = mag[i] ?? 0
      if (m < EDGE_MIN) continue
      // The neighbours across the edge, along the gradient's nearest octant.
      const ax = gx[i] ?? 0
      const ay = gy[i] ?? 0
      const angle = ((Math.atan2(ay, ax) * 180) / Math.PI + 180) % 180
      const [dx, dy] =
        angle < 22.5 || angle >= 157.5
          ? [1, 0]
          : angle < 67.5
            ? [1, 1]
            : angle < 112.5
              ? [0, 1]
              : [-1, 1]
      if (m >= (mag[i + dy * w + dx] ?? 0) && m > (mag[i - dy * w - dx] ?? 0)) thin[i] = 1
    }
  }
  return { width: w, height: h, gx, gy, thin }
}

/** Hough lines: θ in 1° steps, ρ in 1 px, each edge pixel voting within ±3° of its gradient. */
export const houghLines = ({ width: w, height: h, gx, gy, thin }: Edges): Line[] => {
  const diag = Math.ceil(Math.hypot(w, h))
  const rhos = diag * 2 + 1
  const acc = new Uint16Array(180 * rhos)
  const cos = Float64Array.from({ length: 180 }, (_, t) => Math.cos((t * Math.PI) / 180))
  const sin = Float64Array.from({ length: 180 }, (_, t) => Math.sin((t * Math.PI) / 180))
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!thin[i]) continue
      const centre = Math.round(((Math.atan2(gy[i] ?? 0, gx[i] ?? 0) * 180) / Math.PI + 360) % 180)
      for (let d = -3; d <= 3; d++) {
        // θ and θ ± 180° are one line; ρ comes out right from the wrapped θ.
        const t = (centre + d + 180) % 180
        const r = Math.round(x * (cos[t] ?? 0) + y * (sin[t] ?? 0)) + diag
        const k = t * rhos + r
        acc[k] = (acc[k] ?? 0) + 1
      }
    }
  }
  // Peaks: local maxima over ±4° and ±4 px (θ wraps with ρ mirrored).
  const minVotes = Math.min(w, h) * 0.15
  const at = (t: number, r: number) => {
    if (t < 0) return at(t + 180, 2 * diag - r)
    if (t >= 180) return at(t - 180, 2 * diag - r)
    return r < 0 || r >= rhos ? 0 : (acc[t * rhos + r] ?? 0)
  }
  const peaks: Line[] = []
  for (let t = 0; t < 180; t++) {
    for (let r = 0; r < rhos; r++) {
      const v = acc[t * rhos + r] ?? 0
      if (v < minVotes) continue
      let isPeak = true
      for (let dt = -4; dt <= 4 && isPeak; dt++) {
        for (let dr = -4; dr <= 4; dr++) {
          if (dt === 0 && dr === 0) continue
          const u = at(t + dt, r + dr)
          // Ties go to the first in scan order, so a plateau gives one peak.
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            isPeak = false
            break
          }
        }
      }
      if (isPeak) peaks.push({ nx: cos[t] ?? 0, ny: sin[t] ?? 0, rho: r - diag, votes: v })
    }
  }
  return peaks.sort((a, b) => b.votes - a.votes)
}

const intersect = (a: Line, b: Line): Point | null => {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-9) return null
  return { x: (a.rho * b.ny - b.rho * a.ny) / det, y: (a.nx * b.rho - b.nx * a.rho) / det }
}

const angleBetween = (a: Line, b: Line) =>
  (Math.acos(Math.min(1, Math.abs(a.nx * b.nx + a.ny * b.ny))) * 180) / Math.PI

const area = (q: Quad) => {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i] ?? q[0]
    const b = q[(i + 1) % 4] ?? q[0]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/**
 * The share of the side a→b that has an edge across it. The 10% at each end
 * is skipped: corners are where shadows and curl are. Either sense counts:
 * where a shadow falls, paper can be darker than the table along part of a
 * side and lighter along the rest.
 */
export const sideSupport = (e: Edges, a: Point, b: Point) => {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const steps = Math.max(4, Math.floor(len))
  let hits = 0
  let total = 0
  for (let s = 0; s <= steps; s++) {
    const f = s / steps
    if (f < 0.1 || f > 0.9) continue
    total += 1
    const px = a.x + (b.x - a.x) * f
    const py = a.y + (b.y - a.y) * f
    for (let o = -1.5; o <= 1.5; o += 0.75) {
      const x = Math.round(px + nx * o)
      const y = Math.round(py + ny * o)
      if (x < 1 || y < 1 || x >= e.width - 1 || y >= e.height - 1) continue
      const i = y * e.width + x
      const gx = e.gx[i] ?? 0
      const gy = e.gy[i] ?? 0
      const across = Math.abs(gx * nx + gy * ny)
      // Mostly across the side, not along it.
      if (across >= EDGE_MIN && across >= 0.8 * Math.hypot(gx, gy)) {
        hits += 1
        break
      }
    }
  }
  return hits / total
}

/** The weakest side's support; stops early once it's under the bar. */
const quadSupport = (e: Edges, q: Quad) => {
  let weakest = 1
  for (let i = 0; i < 4 && weakest >= MIN_CONFIDENCE; i++) {
    weakest = Math.min(weakest, sideSupport(e, q[i] ?? q[0], q[(i + 1) % 4] ?? q[0]))
  }
  return weakest
}

/**
 * Refits the side a→b to its edge: across each point, the strongest gradient
 * within ±3 px (to a parabola's peak, for subpixel), then a total least
 * squares line through those, with a second pass that drops outliers.
 */
const refineSide = (e: Edges, a: Point, b: Point): Line | null => {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const nx = -(b.y - a.y) / len
  const ny = (b.x - a.x) / len
  const sample = (x: number, y: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 1 || yi < 1 || xi >= e.width - 1 || yi >= e.height - 1) return 0
    const i = yi * e.width + xi
    return Math.abs((e.gx[i] ?? 0) * nx + (e.gy[i] ?? 0) * ny)
  }
  const points: Point[] = []
  const steps = Math.floor(len)
  for (let s = 0; s <= steps; s++) {
    const f = s / steps
    if (f < 0.08 || f > 0.92) continue
    const px = a.x + (b.x - a.x) * f
    const py = a.y + (b.y - a.y) * f
    let bestO = 0
    let best = 0
    for (let o = -3; o <= 3; o++) {
      const v = sample(px + nx * o, py + ny * o)
      if (v > best) {
        best = v
        bestO = o
      }
    }
    if (best < EDGE_MIN || Math.abs(bestO) === 3) continue
    const l = sample(px + nx * (bestO - 1), py + ny * (bestO - 1))
    const r = sample(px + nx * (bestO + 1), py + ny * (bestO + 1))
    const denom = l - 2 * best + r
    const offset = bestO + (denom < 0 ? (0.5 * (l - r)) / denom : 0)
    points.push({ x: px + nx * offset, y: py + ny * offset })
  }
  const fit = (pts: Point[]): Line | null => {
    if (pts.length < 8) return null
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length
    let sxx = 0
    let sxy = 0
    let syy = 0
    for (const p of pts) {
      sxx += (p.x - mx) ** 2
      sxy += (p.x - mx) * (p.y - my)
      syy += (p.y - my) ** 2
    }
    // The normal is the direction of least spread.
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2
    const fx = Math.cos(theta)
    const fy = Math.sin(theta)
    return { nx: fx, ny: fy, rho: mx * fx + my * fy, votes: pts.length }
  }
  const first = fit(points)
  if (!first) return null
  const inliers = points.filter((p) => Math.abs(p.x * first.nx + p.y * first.ny - first.rho) < 1)
  return fit(inliers) ?? first
}

/** Puts four points in top-left, top-right, bottom-right, bottom-left order. */
const ordered = (pts: Point[]): Quad | null => {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const round = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  )
  // Clockwise on screen from the corner nearest the top left.
  const start = round.reduce(
    (best, p, i) => (p.x + p.y < (round[best]?.x ?? 0) + (round[best]?.y ?? 0) ? i : best),
    0,
  )
  const [a, b, c, d] = [0, 1, 2, 3].map((k) => round[(start + k) % 4])
  return a && b && c && d ? [a, b, c, d] : null
}

export const findPaper = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): PaperGuess | null => {
  const e = edges(rgba, width, height)
  const { width: w, height: h } = e
  const lines = houghLines(e)
  // Normals near vertical are horizontal-ish lines (top and bottom sides).
  const across = lines.filter((l) => Math.abs(l.ny) >= Math.SQRT1_2).slice(0, LINES_PER_DIRECTION)
  const down = lines.filter((l) => Math.abs(l.ny) < Math.SQRT1_2).slice(0, LINES_PER_DIRECTION)
  const pairs = (group: Line[]) => {
    const out: [Line, Line][] = []
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (a && b && angleBetween(a, b) <= MAX_SPREAD) out.push([a, b])
      }
    }
    return out
  }
  // Corners may sit a little outside the frame (paper running off the edge).
  const slack = 0.02 * Math.max(w, h)
  const inFrame = (p: Point) => p.x > -slack && p.y > -slack && p.x < w + slack && p.y < h + slack
  const candidates: { quad: Quad; area: number }[] = []
  for (const [t, b] of pairs(across)) {
    for (const [l, r] of pairs(down)) {
      const pts = [intersect(t, l), intersect(t, r), intersect(b, r), intersect(b, l)]
      if (!pts.every((p): p is Point => p !== null && inFrame(p))) continue
      const quad = ordered(pts)
      if (!quad || !isConvex(quad)) continue
      const a = area(quad) / (w * h)
      if (a >= MIN_AREA) candidates.push({ quad, area: a })
    }
  }
  // Biggest first; a smaller quad has to be much better supported to win.
  candidates.sort((a, b) => b.area - a.area)
  let best: { quad: Quad; score: number; support: number } | null = null
  for (const c of candidates) {
    if (best && c.area * 1.5 < best.score) break
    const support = quadSupport(e, c.quad)
    if (support < MIN_CONFIDENCE) continue
    const score = c.area * (0.5 + support)
    if (!best || score > best.score) best = { quad: c.quad, score, support }
  }
  if (!best) return null

  // Refit each side to its edge, then intersect the refined lines.
  const q = best.quad
  const [top, right, bottom, left] = [0, 1, 2, 3].map((i) =>
    refineSide(e, q[i] ?? q[0], q[(i + 1) % 4] ?? q[0]),
  )
  let corners: Point[] = [...q]
  if (top && right && bottom && left) {
    const refined = [
      intersect(left, top),
      intersect(top, right),
      intersect(right, bottom),
      intersect(bottom, left),
    ]
    // Keep the refinement only if it stays close (a bad fit can swing a corner).
    const close = (p: Point | null, i: number): p is Point =>
      p !== null && Math.hypot(p.x - (q[i]?.x ?? 0), p.y - (q[i]?.y ?? 0)) < 4
    if (refined.every(close)) corners = refined
  }
  // Pixel centres: x + 0.5 of w pixels spans the image.
  const frac = (p: Point) => ({
    x: Math.min(1, Math.max(0, (p.x + 0.5) / w)),
    y: Math.min(1, Math.max(0, (p.y + 0.5) / h)),
  })
  const [a, b, c, d] = corners.map(frac)
  if (!a || !b || !c || !d) return null
  const quad: Quad = [a, b, c, d]
  // The paper fills the frame already: nothing to crop.
  const full = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  if (quad.every((p, i) => Math.hypot(p.x - (full[i]?.[0] ?? 0), p.y - (full[i]?.[1] ?? 0)) < 0.02))
    return null
  return isConvex(quad) ? { corners: quad, confidence: best.support } : null
}
