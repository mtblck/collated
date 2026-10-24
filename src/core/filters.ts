import type { Filter } from './model'

/**
 * Pixel filters for document pages, on raw RGBA data so the same code runs in
 * the page (preview thumbnails) and in the export worker (full resolution).
 * Pure and in-place: no canvas, no DOM.
 */

/** ITU-R BT.601 luma, as most scanners use. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

const greyscale = (data: Uint8ClampedArray) => {
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
    data[i] = data[i + 1] = data[i + 2] = y
  }
}

/** How far below the local mean a pixel must be to count as ink. */
export const BW_THRESHOLD = 0.15

/**
 * Which pixels are ink, by adaptive threshold (Bradley–Roth): a pixel is ink
 * when it is clearly darker than the average of its neighbourhood — by
 * `threshold` of that average. A global cut fails on phone photos of paper,
 * where one corner can be in shadow; comparing with the local mean follows
 * the lighting. The window is an eighth of the image's width, so a thumbnail
 * and the full-size export threshold alike. An integral image makes every
 * window sum O(1). One byte per pixel, 1 for ink.
 */
export const inkMask = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = BW_THRESHOLD,
): Uint8Array => {
  const grey = new Float64Array(width * height)
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    grey[p] = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
  }
  // integral[(y + 1) * (width + 1) + (x + 1)] = sum of grey over [0..x] × [0..y]
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x] ?? 0
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + row
    }
  }
  const mask = new Uint8Array(width * height)
  const half = Math.max(1, Math.floor(width / 16))
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const count = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        (integral[(y1 + 1) * stride + x1 + 1] ?? 0) -
        (integral[y0 * stride + x1 + 1] ?? 0) -
        (integral[(y1 + 1) * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0)
      if ((grey[y * width + x] ?? 0) * count < sum * (1 - threshold)) mask[y * width + x] = 1
    }
  }
  return mask
}

/** Black and white: ink black, everything else white (see `inkMask`). */
const blackAndWhite = (data: Uint8ClampedArray, width: number, height: number) => {
  const mask = inkMask(data, width, height)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    data[i] = data[i + 1] = data[i + 2] = mask[p] ? 0 : 255
  }
}

/** Cells across the page for the paper estimate; rows follow the aspect. */
export const ENHANCE_CELLS = 24
/** Share of a cell's pixels taken to be paper: its estimate is this percentile. */
const PAPER_PERCENTILE = 0.9
/** After dividing out the paper, values at or above this go to white… */
const ENHANCE_WHITE = 0.9
/** …and at or below this to black, with a gentle gamma on the ink between. */
const ENHANCE_BLACK = 0.06
const ENHANCE_GAMMA = 1.15

/**
 * Enhance: whiten the paper and keep the colour, like a phone scanner's
 * "magic colour". Each channel is divided by an estimate of the paper under
 * that pixel, so a shadow or a warm cast goes and the paper comes out white
 * while ink keeps its hue (a red stamp stays red, a yellow highlight yellow).
 *
 * The paper estimate is a coarse grid (ENHANCE_CELLS across, square cells)
 * holding each cell's 90th percentile per channel: text covers far less than
 * a tenth of a cell, so the percentile lands on paper. Each cell then takes
 * its brightest neighbour (a cell filled by a logo or a photo borrows the
 * paper beside it), the grid is smoothed, and pixels read it by bilinear
 * interpolation between cell centres. Everything is in fractions of the
 * image, so a thumbnail and the full-size export come out alike.
 */
const enhance = (data: Uint8ClampedArray, width: number, height: number) => {
  const cols = Math.max(1, Math.min(ENHANCE_CELLS, width))
  const rows = Math.max(1, Math.min(height, Math.round((height * cols) / width)))
  const cells = cols * rows
  const colOf = new Uint32Array(width)
  for (let x = 0; x < width; x++) colOf[x] = Math.floor((x * cols) / width)

  // Per-cell, per-channel histograms, then each one's percentile.
  const hist = new Uint32Array(cells * 3 * 256)
  const counts = new Uint32Array(cells)
  for (let y = 0; y < height; y++) {
    const rowBase = Math.floor((y * rows) / height) * cols
    for (let x = 0; x < width; x++) {
      const c = rowBase + (colOf[x] ?? 0)
      const i = (y * width + x) * 4
      const h = c * 768
      counts[c] = (counts[c] ?? 0) + 1
      hist[h + (data[i] ?? 0)] = (hist[h + (data[i] ?? 0)] ?? 0) + 1
      hist[h + 256 + (data[i + 1] ?? 0)] = (hist[h + 256 + (data[i + 1] ?? 0)] ?? 0) + 1
      hist[h + 512 + (data[i + 2] ?? 0)] = (hist[h + 512 + (data[i + 2] ?? 0)] ?? 0) + 1
    }
  }
  const paper = new Float64Array(cells * 3)
  for (let c = 0; c < cells; c++) {
    const below = Math.floor((counts[c] ?? 0) * PAPER_PERCENTILE)
    for (let k = 0; k < 3; k++) {
      const base = c * 768 + k * 256
      let seen = 0
      let v = 0
      while (v < 255 && seen + (hist[base + v] ?? 0) <= below) seen += hist[base + v++] ?? 0
      paper[c * 3 + k] = v
    }
  }

  // Brightest neighbour, then a 3×3 mean: both per channel, edges clamped.
  const neighbourhood = (src: Float64Array, pick: (vals: number[]) => number) => {
    const out = new Float64Array(src.length)
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        for (let k = 0; k < 3; k++) {
          const vals: number[] = []
          for (let dr = -1; dr <= 1; dr++) {
            for (let dq = -1; dq <= 1; dq++) {
              const rr = Math.min(rows - 1, Math.max(0, r + dr))
              const qq = Math.min(cols - 1, Math.max(0, q + dq))
              vals.push(src[(rr * cols + qq) * 3 + k] ?? 0)
            }
          }
          out[(r * cols + q) * 3 + k] = pick(vals)
        }
      }
    }
    return out
  }
  const grid = neighbourhood(
    neighbourhood(paper, (v) => Math.max(...v)),
    (v) => v.reduce((a, b) => a + b, 0) / v.length,
  )
  // A cell with no paper in reach (a dark photo filling the page) must not be
  // blown out to white: never divide by less than half the page's own paper.
  for (let k = 0; k < 3; k++) {
    let top = 0
    for (let c = 0; c < cells; c++) top = Math.max(top, grid[c * 3 + k] ?? 0)
    const floor = Math.max(16, top / 2)
    for (let c = 0; c < cells; c++) grid[c * 3 + k] = Math.max(floor, grid[c * 3 + k] ?? 0)
  }

  // Tone curve as a table on the normalised value (0…1 in 1/1024 steps).
  const STEPS = 1024
  const curve = new Float64Array(STEPS + 1)
  for (let s = 0; s <= STEPS; s++) {
    const t = Math.min(
      1,
      Math.max(0, (s / STEPS - ENHANCE_BLACK) / (ENHANCE_WHITE - ENHANCE_BLACK)),
    )
    curve[s] = 255 * t ** ENHANCE_GAMMA
  }

  // Bilinear weights between cell centres, per column once.
  const q0s = new Uint32Array(width)
  const q1s = new Uint32Array(width)
  const fxs = new Float64Array(width)
  for (let x = 0; x < width; x++) {
    const gx = Math.min(cols - 1, Math.max(0, ((x + 0.5) * cols) / width - 0.5))
    const q0 = Math.floor(gx)
    q0s[x] = q0
    q1s[x] = Math.min(cols - 1, q0 + 1)
    fxs[x] = gx - q0
  }
  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.max(0, ((y + 0.5) * rows) / height - 0.5))
    const r0 = Math.floor(gy) * cols
    const r1 = Math.min(rows - 1, Math.floor(gy) + 1) * cols
    const fy = gy - Math.floor(gy)
    for (let x = 0; x < width; x++) {
      const fx = fxs[x] ?? 0
      const a = (r0 + (q0s[x] ?? 0)) * 3
      const b = (r0 + (q1s[x] ?? 0)) * 3
      const c = (r1 + (q0s[x] ?? 0)) * 3
      const d = (r1 + (q1s[x] ?? 0)) * 3
      const i = (y * width + x) * 4
      for (let k = 0; k < 3; k++) {
        const bg =
          ((grid[a + k] ?? 255) * (1 - fx) + (grid[b + k] ?? 255) * fx) * (1 - fy) +
          ((grid[c + k] ?? 255) * (1 - fx) + (grid[d + k] ?? 255) * fx) * fy
        const v = Math.min(1, (data[i + k] ?? 0) / bg)
        data[i + k] = curve[Math.round(v * STEPS)] ?? 255
      }
    }
  }
}

export const applyFilter = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filter: Filter,
): void => {
  if (filter === 'grey') greyscale(data)
  else if (filter === 'enhance') enhance(data, width, height)
  else if (filter === 'bw') blackAndWhite(data, width, height)
}

/**
 * How a filtered page is stored: greyscale and enhanced as JPEG (smooth tones
 * compress well), black and white as PNG (lossless, so text edges stay sharp and the
 * flat white compresses to almost nothing).
 */
export const filterEncoding = (filter: Exclude<Filter, 'original'>) =>
  filter === 'bw'
    ? ({ format: 'png', type: 'image/png' } as const)
    : ({ format: 'jpeg', type: 'image/jpeg', quality: 0.9 } as const)
