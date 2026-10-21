import { applyFilter } from './filters'

export interface Skew {
  /** Clockwise degrees to rotate the page by to level its lines (the Straighten value). */
  angle: number
  /** How much better the best angle scores than the average one; ≥ MIN_CONFIDENCE to trust. */
  confidence: number
}

/** The furthest skew searched, in degrees: beyond this a scan wants a quarter turn. */
export const SKEW_RANGE = 15
/** Below this, the peak isn't clearly better than chance: no lines to go by. */
export const MIN_CONFIDENCE = 1.15

const MAX_POINTS = 40_000

/**
 * Estimates how far a page's text (or ruled lines, or table edges) is tilted,
 * by the projection-profile method: rotate the ink, count it per row, and
 * the angle at which the rows are most uneven — dark lines, clean gaps — is
 * the one that levels the text. Rows and columns are both scored, so a page
 * that's on its side (text running vertically) is straightened too.
 *
 * Works on RGBA pixels (a thumbnail is plenty): binarised with the B&W
 * filter's adaptive threshold, ignoring a 3% border where photos of paper
 * pick up the table or the page's own edge. Returns null when there aren't
 * enough lines to judge.
 */
export const estimateSkew = (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Skew | null => {
  const data = rgba.slice()
  applyFilter(data, width, height, 'bw')

  const border = Math.round(Math.min(width, height) * 0.03)
  const xs: number[] = []
  const ys: number[] = []
  for (let y = border; y < height - border; y++) {
    for (let x = border; x < width - border; x++) {
      if (data[(y * width + x) * 4] === 0) {
        xs.push(x - width / 2)
        ys.push(y - height / 2)
      }
    }
  }
  if (xs.length < 200) return null
  // Even subsample keeps every angle's score comparable and bounds the work.
  const stride = Math.max(1, Math.ceil(xs.length / MAX_POINTS))

  const diagonal = Math.ceil(Math.hypot(width, height))
  const bins = new Float64Array(diagonal * 2 + 1)
  const profile = (degrees: number, axis: 'rows' | 'cols') => {
    const r = (degrees * Math.PI) / 180
    const sin = Math.sin(r)
    const cos = Math.cos(r)
    bins.fill(0)
    for (let i = 0; i < xs.length; i += stride) {
      const x = xs[i] ?? 0
      const y = ys[i] ?? 0
      // Rotate the point by -degrees; level lines then share a coordinate.
      const v = axis === 'rows' ? -x * sin + y * cos : x * cos + y * sin
      const bin = Math.round(v) + diagonal
      bins[bin] = (bins[bin] ?? 0) + 1
    }
    let sum = 0
    for (const count of bins) sum += count * count
    return sum
  }
  const score = (degrees: number) => Math.max(profile(degrees, 'rows'), profile(degrees, 'cols'))

  let best = 0
  let bestScore = -1
  let total = 0
  let samples = 0
  for (let a = -SKEW_RANGE; a <= SKEW_RANGE + 1e-9; a += 0.5) {
    const s = score(a)
    total += s
    samples += 1
    if (s > bestScore) {
      bestScore = s
      best = a
    }
  }
  const coarseMean = total / samples
  for (let a = best - 0.5; a <= best + 0.5 + 1e-9; a += 0.05) {
    const s = score(a)
    if (s > bestScore) {
      bestScore = s
      best = a
    }
  }
  const confidence = bestScore / coarseMean
  if (confidence < MIN_CONFIDENCE) return null
  // Content tilted clockwise by `best` is levelled by turning it back.
  const angle = Math.round(-best * 10) / 10
  return { angle: Object.is(angle, -0) ? 0 : angle, confidence }
}
