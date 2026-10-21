/**
 * Just enough JPEG and PNG parsing to decide whether a file can go into the
 * PDF byte-for-byte. Re-encoding a scan through a canvas costs quality and
 * usually size, so passthrough is the default whenever it's safe.
 *
 * The type comes from the file's magic bytes, never its name or MIME type.
 */

export type SniffedType = 'jpeg' | 'png' | 'pdf' | 'heic' | 'other'

export const sniff = (bytes: Uint8Array): SniffedType => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return 'png'
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf'
  // ISO-BMFF: ....ftyp<brand>. HEIC/HEIF brands; AVIF is decoded by browsers.
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12)
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return 'other'
}

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end))

export interface JpegInfo {
  /** Stored (pre-orientation) pixel size. */
  width: number
  height: number
  /** 1 grey, 3 YCbCr/RGB, 4 CMYK. */
  components: number
  /** EXIF orientation 1–8; 1 when absent. */
  orientation: number
}

/** Start-of-frame markers: baseline, extended, progressive, lossless (not DHT/JPG/DAC). */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

export const readJpegInfo = (bytes: Uint8Array): JpegInfo | null => {
  if (sniff(bytes) !== 'jpeg') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let orientation = 1
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1] ?? 0
    // Fill bytes and standalone markers carry no length.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2
      continue
    }
    const length = view.getUint16(offset + 2)
    const body = offset + 4
    if (marker === 0xe1 && ascii(bytes, body, body + 6) === 'Exif\0\0') {
      orientation = readExifOrientation(view, body + 6) ?? orientation
    } else if (isStartOfFrame(marker)) {
      if (body + 6 > bytes.length) return null
      return {
        height: view.getUint16(body + 1),
        width: view.getUint16(body + 3),
        components: view.getUint8(body + 5),
        orientation,
      }
    } else if (marker === 0xda || marker === 0xd9) {
      return null // reached image data without a frame header
    }
    offset += 2 + length
  }
  return null
}

const readExifOrientation = (view: DataView, tiff: number): number | null => {
  if (tiff + 8 > view.byteLength) return null
  const order = view.getUint16(tiff)
  const little = order === 0x4949 // "II"
  if (!little && order !== 0x4d4d) return null // "MM"
  const ifd = tiff + view.getUint32(tiff + 4, little)
  if (ifd + 2 > view.byteLength) return null
  const count = view.getUint16(ifd, little)
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12
    if (entry + 12 > view.byteLength) return null
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/**
 * Clockwise quarter turns that make stored JPEG pixels upright, or null when
 * the orientation also mirrors (2, 4, 5, 7) and can't be a plain rotation.
 */
export const orientationTurns = (orientation: number): 0 | 1 | 2 | 3 | null => {
  switch (orientation) {
    case 1:
      return 0
    case 6:
      return 1
    case 3:
      return 2
    case 8:
      return 3
    default:
      return null
  }
}

export interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  interlaced: boolean
}

export const readPngInfo = (bytes: Uint8Array): PngInfo | null => {
  if (sniff(bytes) !== 'png' || bytes.length < 29 || ascii(bytes, 12, 16) !== 'IHDR') return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: view.getUint8(24),
    colorType: view.getUint8(25),
    interlaced: view.getUint8(28) === 1,
  }
}

export type Passthrough =
  | { ok: true; format: 'jpeg' | 'png'; storedTurns: 0 | 1 | 2 | 3; width: number; height: number }
  | { ok: false; reason: string }

/**
 * Decides whether these bytes can be embedded as they are. `width`/`height`
 * returned are the upright size. Anything not ok gets re-encoded once from the
 * browser's decode.
 */
export const passthrough = (bytes: Uint8Array): Passthrough => {
  const type = sniff(bytes)
  if (type === 'jpeg') {
    const info = readJpegInfo(bytes)
    if (!info) return { ok: false, reason: 'unreadable JPEG header' }
    // CMYK JPEGs from some scanners are stored inverted (Adobe APP14) and
    // render as a negative in several PDF viewers. Let the browser convert.
    if (info.components !== 1 && info.components !== 3) return { ok: false, reason: 'CMYK JPEG' }
    const turns = orientationTurns(info.orientation)
    if (turns === null) return { ok: false, reason: 'mirrored EXIF orientation' }
    const swap = turns % 2 === 1
    return {
      ok: true,
      format: 'jpeg',
      storedTurns: turns,
      width: swap ? info.height : info.width,
      height: swap ? info.width : info.height,
    }
  }
  if (type === 'png') {
    const info = readPngInfo(bytes)
    if (!info) return { ok: false, reason: 'unreadable PNG header' }
    // pdf-lib's PNG decoder handles 8-bit non-interlaced images reliably.
    if (info.bitDepth > 8 || info.interlaced)
      return { ok: false, reason: '16-bit or interlaced PNG' }
    return { ok: true, format: 'png', storedTurns: 0, width: info.width, height: info.height }
  }
  return { ok: false, reason: `${type} needs converting` }
}

/**
 * The pixel size a JPEG or PNG header declares (stored orientation), or null
 * for other types or an unreadable header. Read before decoding, so a file
 * claiming an absurd size is refused without allocating for it.
 */
export const headerSize = (bytes: Uint8Array): { width: number; height: number } | null => {
  const info = readJpegInfo(bytes) ?? readPngInfo(bytes)
  if (info) return { width: info.width, height: info.height }
  return readWebpSize(bytes) ?? readGifSize(bytes) ?? readBmpSize(bytes)
}

const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16)
const i32le = (b: Uint8Array, i: number) => u24le(b, i) | ((b[i + 3] ?? 0) << 24)
/** Whether `tag` (ASCII) is at `i`. */
const tagAt = (b: Uint8Array, i: number, tag: string) => {
  for (let k = 0; k < tag.length; k++) if (b[i + k] !== tag.charCodeAt(k)) return false
  return true
}

/** WebP: lossy (VP8), lossless (VP8L) or extended (VP8X) canvas size. */
const readWebpSize = (b: Uint8Array) => {
  if (b.length < 30 || !tagAt(b, 0, 'RIFF') || !tagAt(b, 8, 'WEBP')) return null
  if (tagAt(b, 12, 'VP8X')) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  if (tagAt(b, 12, 'VP8L')) {
    const bits = i32le(b, 21) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (tagAt(b, 12, 'VP8 ')) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  return null
}

/** GIF: the logical screen size. */
const readGifSize = (b: Uint8Array) =>
  b.length >= 10 && (tagAt(b, 0, 'GIF87a') || tagAt(b, 0, 'GIF89a'))
    ? { width: u16le(b, 6), height: u16le(b, 8) }
    : null

/** BMP: the info header's size (height is negative for top-down bitmaps). */
const readBmpSize = (b: Uint8Array) =>
  b.length >= 26 && tagAt(b, 0, 'BM')
    ? { width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) }
    : null
