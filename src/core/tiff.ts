/**
 * The parts of TIFF import (#113) that are plain arithmetic, kept apart from
 * the decoder so they're tested without a worker: finding the pages, reading
 * the resolution, and turning a decoded page upright with square pixels.
 */

/** Pages accepted from one TIFF, as for a PDF (each page gets a thumbnail). */
export const MAX_TIFF_PAGES = 500

export type TiffHeader =
  | { ok: true; little: boolean; offsets: number[] }
  | { ok: false; reason: 'not-tiff' | 'bigtiff' | 'too-many-pages'; pages?: number }

/**
 * The offset of every top-level IFD (one per page, plus any thumbnails),
 * following the chain from the header. A chain that loops back on itself
 * ends where it would repeat, and a damaged pointer ends it there.
 */
export const readTiffHeader = (bytes: Uint8Array, maxPages = MAX_TIFF_PAGES): TiffHeader => {
  if (bytes.length < 8) return { ok: false, reason: 'not-tiff' }
  const little = bytes[0] === 0x49 && bytes[1] === 0x49
  if (!little && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) return { ok: false, reason: 'not-tiff' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = view.getUint16(2, little)
  if (magic === 43) return { ok: false, reason: 'bigtiff' }
  if (magic !== 42) return { ok: false, reason: 'not-tiff' }
  const offsets: number[] = []
  const seen = new Set<number>()
  let next = view.getUint32(4, little)
  // Twice the page cap, so thumbnails between pages don't count against it.
  while (next !== 0 && !seen.has(next) && next + 2 <= bytes.length) {
    seen.add(next)
    offsets.push(next)
    if (offsets.length > maxPages * 2) return { ok: false, reason: 'too-many-pages' }
    const count = view.getUint16(next, little)
    const pointer = next + 2 + count * 12
    if (pointer + 4 > bytes.length) break
    next = view.getUint32(pointer, little)
  }
  return { ok: true, little, offsets }
}

/** The tags read from an IFD, as the decoder gives them ("t282" and so on). */
export type Ifd = Record<string, unknown>

const numbers = (value: unknown): number[] =>
  Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : []

/** First value of a numeric tag, or `fallback`. */
export const tag = (ifd: Ifd, id: number, fallback: number): number =>
  numbers(ifd[`t${String(id)}`])[0] ?? fallback

/** A RATIONAL tag's first value: the decoder gives [numerator, denominator] pairs. */
const rational = (ifd: Ifd, id: number): number | null => {
  const value = ifd[`t${String(id)}`]
  const first: unknown = Array.isArray(value) ? value[0] : undefined
  if (typeof first === 'number') return first
  if (!Array.isArray(first)) return null
  const [n, d] = first as unknown[]
  return typeof n === 'number' && typeof d === 'number' && d > 0 ? n / d : null
}

/** Whether an IFD is a page, not a thumbnail or a transparency mask (NewSubfileType). */
export const isPage = (ifd: Ifd) =>
  ifd.t256 !== undefined && ifd.t257 !== undefined && (tag(ifd, 254, 0) & 0b101) === 0

/** Resolutions outside this range are mistakes (or a unitless 72/1), not scans. */
const DPI_MIN = 36
const DPI_MAX = 4800

export interface Resolution {
  /** Pixels per inch across and down; with `absolute` false, only their ratio means anything. */
  x: number
  y: number
  absolute: boolean
}

/**
 * Resolution from XResolution, YResolution and ResolutionUnit (2 inch, the
 * default; 3 centimetre; 1 none, which still gives the pixels' shape). Null
 * when the file doesn't say or says something no scanner would.
 */
export const tiffResolution = (ifd: Ifd): Resolution | null => {
  const unit = tag(ifd, 296, 2)
  if (unit !== 1 && unit !== 2 && unit !== 3) return null
  const perInch = unit === 3 ? 2.54 : 1
  const x = (rational(ifd, 282) ?? 0) * perInch
  const y = (rational(ifd, 283) ?? x / perInch) * perInch
  if (unit === 1) {
    const ok = (n: number) => Number.isFinite(n) && n > 0
    // Shape only: anything past 1:4 is a broken tag, not a fax.
    return ok(x) && ok(y) && Math.max(x / y, y / x) <= 4 ? { x, y, absolute: false } : null
  }
  const ok = (n: number) => Number.isFinite(n) && n >= DPI_MIN && n <= DPI_MAX
  return ok(x) && ok(y) ? { x, y, absolute: true } : null
}

/** TIFF Orientation 5–8 store the picture transposed: its rows are the upright columns. */
const transposed = (orientation: number) => orientation >= 5 && orientation <= 8

export interface PagePlan {
  /** Upright output size, with square pixels. */
  width: number
  height: number
  /** Its resolution in pixels per inch, or null when the file has none. */
  dpi: number | null
}

/**
 * The upright, square-pixel size a stored page becomes. A fax at standard
 * resolution (204 × 98 dpi) has dots twice as tall as wide: its rows are
 * repeated so it comes out at 204 dpi both ways, the right shape and size.
 * The finer axis is kept, so nothing is thrown away.
 */
export const planPage = (
  width: number,
  height: number,
  orientation: number,
  resolution: Resolution | null,
): PagePlan => {
  const swap = transposed(orientation)
  // Resolution belongs to the stored axes; after a transpose they trade places.
  const across = resolution ? (swap ? resolution.y : resolution.x) : 1
  const down = resolution ? (swap ? resolution.x : resolution.y) : 1
  const dpi = Math.max(across, down)
  const uprightW = swap ? height : width
  const uprightH = swap ? width : height
  return {
    width: Math.max(1, Math.round((uprightW * dpi) / across)),
    height: Math.max(1, Math.round((uprightH * dpi) / down)),
    dpi: resolution?.absolute ? dpi : null,
  }
}

/**
 * Copies a stored page (one element per pixel: a byte for black and white,
 * a 32-bit word for RGBA) into its upright, square-pixel plan, nearest
 * neighbour. Returns `pixels` itself when there's nothing to do.
 */
export const reshape = <T extends Uint8Array | Uint32Array>(
  pixels: T,
  width: number,
  height: number,
  orientation: number,
  plan: Pick<PagePlan, 'width' | 'height'>,
  make: (length: number) => T,
): T => {
  const swap = transposed(orientation)
  const uprightW = swap ? height : width
  const uprightH = swap ? width : height
  const plain = orientation < 2 || orientation > 8
  if (plain && plan.width === width && plan.height === height) return pixels
  const out = make(plan.width * plan.height)
  // Upright column for each output column, and row for each output row.
  const cols = new Int32Array(plan.width)
  for (let x = 0; x < plan.width; x++) cols[x] = Math.floor((x * uprightW) / plan.width)
  for (let y = 0; y < plan.height; y++) {
    const uy = Math.floor((y * uprightH) / plan.height)
    const row = y * plan.width
    for (let x = 0; x < plan.width; x++) {
      const ux = cols[x] ?? 0
      // Where upright (ux, uy) is stored.
      let sx = ux
      let sy = uy
      switch (orientation) {
        case 2:
          sx = width - 1 - ux
          break
        case 3:
          sx = width - 1 - ux
          sy = height - 1 - uy
          break
        case 4:
          sy = height - 1 - uy
          break
        case 5:
          sx = uy
          sy = ux
          break
        case 6:
          sx = uy
          sy = height - 1 - ux
          break
        case 7:
          sx = width - 1 - uy
          sy = height - 1 - ux
          break
        case 8:
          sx = width - 1 - uy
          sy = ux
          break
      }
      out[row + x] = pixels[sy * width + sx] ?? 0
    }
  }
  return out
}

/**
 * One byte per pixel (0 black, 1 white) from 1-bit rows, each padded to a
 * whole byte. TIFF's WhiteIsZero (fax) stores white as 0; BlackIsZero as 1.
 */
export const unpackBits = (
  data: Uint8Array,
  width: number,
  height: number,
  whiteIsZero: boolean,
): Uint8Array => {
  const stride = Math.ceil(width / 8)
  const out = new Uint8Array(width * height)
  const white = whiteIsZero ? 0 : 1
  for (let y = 0; y < height; y++) {
    const row = y * stride
    const to = y * width
    for (let x = 0; x < width; x++) {
      const bit = ((data[row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1
      out[to + x] = bit === white ? 1 : 0
    }
  }
  return out
}
