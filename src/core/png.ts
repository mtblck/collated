import { zlibSync } from 'fflate'

/**
 * Two small PNG jobs for 1-bit scans (#113): writing a black-and-white PNG
 * from a fax page, and reading a greyscale PNG's compressed data so the PDF
 * can carry it as it is. pdf-lib's own PNG embedding expands every PNG to
 * 8-bit RGB, which turns a 40 KB fax page into several hundred kilobytes.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * A 1-bit greyscale PNG from one byte per pixel (0 black, anything else
 * white), row by row. Rows go unfiltered: on black and white the filters
 * don't help, and deflate does the work.
 */
export const encodePng1 = (pixels: Uint8Array, width: number, height: number): Uint8Array => {
  const stride = Math.ceil(width / 8)
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1) + 1 // after the filter byte (0, none)
    const from = y * width
    for (let x = 0; x < width; x++) {
      const at = row + (x >> 3)
      if (pixels[from + x]) raw[at] = (raw[at] ?? 0) | (0x80 >> (x & 7))
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 1 // bit depth
  header[9] = 0 // greyscale
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export interface GreyPng {
  width: number
  height: number
  bitDepth: 1 | 2 | 4 | 8
  /** The zlib stream of the image data (every IDAT joined), with PNG's row filters. */
  data: Uint8Array
}

/**
 * The compressed data of an opaque, non-interlaced greyscale PNG of up to 8
 * bits, or null for any other PNG. A PDF reads that stream as it is
 * (FlateDecode with PNG predictors), so nothing is decoded or recompressed.
 */
export const readGreyPng = (bytes: Uint8Array): GreyPng | null => {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8))
  if (type(8) !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  const bitDepth = bytes[24] ?? 0
  const colourType = bytes[25]
  const interlaced = bytes[28] !== 0
  if (colourType !== 0 || interlaced || ![1, 2, 4, 8].includes(bitDepth)) return null
  if (width === 0 || height === 0) return null
  const parts: Uint8Array[] = []
  let at = 8
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at)
    const name = type(at)
    const end = at + 12 + length
    if (end > bytes.length) return null
    // A transparent grey would need a mask; leave that to the general path.
    if (name === 'tRNS') return null
    if (name === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length))
    if (name === 'IEND') break
    at = end
  }
  if (parts.length === 0) return null
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    data.set(part, offset)
    offset += part.length
  }
  return { width, height, bitDepth: bitDepth as GreyPng['bitDepth'], data }
}
