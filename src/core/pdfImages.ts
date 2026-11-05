import {
  PDFArray,
  PDFBool,
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFObject,
  type PDFPage,
} from '@cantoo/pdf-lib'
import { pdfImageTarget, type Compression } from './compression'
import { readJpegInfo } from './imageInfo'
import { sanitizedPage } from './pdfSanitize'

/**
 * Shrinking the pictures inside PDF pages (#115). A scanned PDF is a picture
 * per page, often at 300–600 dpi, so a quality preset or a size limit that
 * left PDF pages alone left most of the file alone. Each picture a page draws
 * is re-encoded like a photo would be (capped at the preset's dpi, JPEG at
 * its quality) and swapped in place; the page's text, fonts, drawings and
 * any invisible OCR layer stay exactly as they are, so text stays sharp and
 * searchable. Worker only (pdf-lib).
 *
 * Only pictures a browser can decode faithfully are touched: 8-bit JPEGs
 * (grey or colour) and 8-bit Flate images in grey, RGB or an ICC profile of
 * those. Black-and-white scans (JBIG2, CCITT, 1-bit) are already small, and
 * CMYK, indexed, JPEG 2000 and masked-by-colour images would change colour
 * or edges; they're kept.
 */

/** A picture on a page that can be shrunk, as reported before export (for the estimate). */
export interface PdfImageInfo {
  /** The image's object in its file: the same in every page that draws it. */
  key: string
  width: number
  height: number
  /** Stored size, in bytes. */
  bytes: number
  /** How it's stored: as a JPEG, or as compressed pixels (which a JPEG beats by far). */
  encoding: 'jpeg' | 'flate'
}

/**
 * The largest picture decoded to shrink it: a 600 dpi Letter scan is 34 MP.
 * Decoding takes 3–4 bytes a pixel in the worker, which phones run short of.
 */
export const MAX_SHRINK_SOURCE_PIXELS = 50_000_000

/** Smaller pictures aren't worth a re-encode: little to save, and each costs a decode. */
export const MIN_SHRINK_BYTES = 24 * 1024

/** What to re-encode, decoded as far as pdf-lib can: JPEG data, or raw 8-bit pixels. */
export type ShrinkSource =
  | { kind: 'jpeg'; data: Uint8Array }
  | { kind: 'pixels'; data: Uint8Array; channels: 1 | 3; width: number; height: number }

export interface ShrinkJob {
  source: ShrinkSource
  /** Output pixels. */
  width: number
  height: number
  /** JPEG quality, 0–1. */
  quality: number
}

/** Re-encodes a picture as an RGB JPEG of the job's size (the worker's canvas). */
export type ShrinkImage = (job: ShrinkJob) => Promise<Uint8Array>

const name = (context: PDFContext, value: PDFObject | undefined) => {
  const resolved = value === undefined ? undefined : context.lookup(value)
  return resolved instanceof PDFName ? resolved.decodeText() : undefined
}

const number = (context: PDFContext, value: PDFObject | undefined) => {
  const resolved = value === undefined ? undefined : context.lookup(value)
  return resolved instanceof PDFNumber ? resolved.asNumber() : undefined
}

/** Colour components of a colour space we can hand a browser as grey or RGB; null otherwise. */
const components = (context: PDFContext, value: PDFObject | undefined): 1 | 3 | null => {
  const space = value === undefined ? undefined : context.lookup(value)
  if (space instanceof PDFName) {
    const n = space.decodeText()
    return n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : null
  }
  if (!(space instanceof PDFArray)) return null
  const family = name(context, space.get(0))
  if (family === 'CalRGB') return 3
  if (family === 'CalGray') return 1
  if (family === 'ICCBased') {
    const profile = context.lookup(space.get(1))
    const n = profile instanceof PDFStream ? number(context, profile.dict.get(PDFName.of('N'))) : 0
    return n === 3 ? 3 : n === 1 ? 1 : null
  }
  return null
}

type Readable = NonNullable<ReturnType<typeof readable>>

/** How a picture is read back, or null if it's one to keep as it is. */
const readable = (context: PDFContext, stream: PDFRawStream) => {
  const { dict } = stream
  const get = (key: string) => dict.get(PDFName.of(key))
  if (stream.contents.length < MIN_SHRINK_BYTES) return null
  const mask = get('ImageMask')
  if (mask && context.lookup(mask) === PDFBool.True) return null
  // A colour-key mask names exact colours, which a lossy re-encode would miss.
  if (get('Mask') && context.lookup(get('Mask')) instanceof PDFArray) return null
  if (get('Decode')) return null
  // A pre-multiplied soft mask (Matte) must keep its image's size.
  const soft = get('SMask') ? context.lookup(get('SMask')) : undefined
  if (soft instanceof PDFStream && soft.dict.has(PDFName.of('Matte'))) return null
  if (number(context, get('BitsPerComponent')) !== 8) return null
  const width = number(context, get('Width')) ?? 0
  const height = number(context, get('Height')) ?? 0
  if (width < 1 || height < 1 || width * height > MAX_SHRINK_SOURCE_PIXELS) return null
  const channels = components(context, get('ColorSpace'))
  if (!channels) return null
  const filter = context.lookup(get('Filter') ?? PDFName.of('None'))
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter]
  if (filters.length !== 1) return null
  const codec = name(context, filters[0])
  if (codec === 'DCTDecode') {
    // ColorTransform overrides how the browser would read the colours.
    if (get('DecodeParms')) return null
    const info = readJpegInfo(stream.contents)
    // The frame must be what the dictionary says (a CMYK or odd JPEG isn't),
    // and upright: PDF viewers ignore EXIF orientation, browsers apply it.
    if (
      info?.components !== channels ||
      info.width !== width ||
      info.height !== height ||
      info.orientation !== 1
    ) {
      return null
    }
    return { width, height, channels, codec } as const
  }
  if (codec !== 'FlateDecode') return null
  const parms = get('DecodeParms') ? context.lookup(get('DecodeParms')) : undefined
  if (parms !== undefined && !(parms instanceof PDFDict)) return null
  const predictor = parms ? (number(context, parms.get(PDFName.of('Predictor'))) ?? 1) : 1
  if (predictor !== 1) {
    // PNG predictors only (10–15), with rows exactly as the image.
    if (predictor < 10 || !parms) return null
    const colors = number(context, parms.get(PDFName.of('Colors'))) ?? 1
    const bits = number(context, parms.get(PDFName.of('BitsPerComponent'))) ?? 8
    const columns = number(context, parms.get(PDFName.of('Columns'))) ?? 1
    if (colors !== channels || bits !== 8 || columns !== width) return null
  }
  return { width, height, channels, codec, predictor } as const
}

const isImage = (context: PDFContext, dict: PDFDict) =>
  name(context, dict.get(PDFName.of('Subtype'))) === 'Image'

/**
 * The pictures a (sanitized) page draws that can be shrunk, each once:
 * through its resources, forms, patterns and Type 3 glyphs, however deep.
 * An image's own soft mask is part of that image and isn't listed.
 */
export const shrinkableImages = (page: PDFPage) => {
  const context = page.doc.context
  const found = new Map<
    string,
    { ref: PDFRef; stream: PDFRawStream; read: Readable; info: PdfImageInfo }
  >()
  const seen = new Set<PDFObject>()
  const walk = (object: PDFObject | undefined, depth: number) => {
    if (!object || depth > 64 || seen.has(object)) return
    seen.add(object)
    const ref = object instanceof PDFRef ? object : undefined
    const value = ref ? context.lookup(ref) : object
    if (value instanceof PDFArray) {
      for (const item of value.asArray()) walk(item, depth + 1)
      return
    }
    const dict =
      value instanceof PDFStream ? value.dict : value instanceof PDFDict ? value : undefined
    if (!dict) return
    if (isImage(context, dict)) {
      const read = ref && value instanceof PDFRawStream ? readable(context, value) : null
      if (ref && value instanceof PDFRawStream && read) {
        const key = `${String(ref.objectNumber)} ${String(ref.generationNumber)}`
        const width = number(context, dict.get(PDFName.of('Width'))) ?? 0
        const height = number(context, dict.get(PDFName.of('Height'))) ?? 0
        found.set(key, {
          ref,
          stream: value,
          read,
          info: {
            key,
            width,
            height,
            bytes: value.contents.length,
            encoding: read.codec === 'DCTDecode' ? 'jpeg' : 'flate',
          },
        })
      }
      return
    }
    for (const [key, entry] of dict.entries()) {
      if (key.decodeText() !== 'Parent') walk(entry, depth + 1)
    }
  }
  walk(page.node.get(PDFName.of('Resources')), 0)
  return [...found.values()]
}

/**
 * Undoes PNG row filters (predictors 10–15: each row says its own), in place:
 * the rows are moved down over their filter bytes, so a big scan isn't held
 * twice. Returns the pixels, a view of `data`.
 */
export const unfilterPng = (data: Uint8Array, rowBytes: number, bpp: number, rows: number) => {
  const stride = rowBytes + 1
  if (data.length < stride * rows) throw new Error('The image data is short.')
  // Each pixel is written before (or at) where it was read from, and every
  // pixel it predicts from is already written, so one buffer will do.
  for (let y = 0; y < rows; y++) {
    const type = data[y * stride] ?? 0
    if (type > 4) throw new Error('The image data uses an unknown row filter.')
    const src = y * stride + 1
    const row = y * rowBytes
    const up = row - rowBytes
    for (let x = 0; x < rowBytes; x++) {
      const raw = data[src + x] ?? 0
      const a = x >= bpp ? (data[row + x - bpp] ?? 0) : 0
      const b = y > 0 ? (data[up + x] ?? 0) : 0
      const c = x >= bpp && y > 0 ? (data[up + x - bpp] ?? 0) : 0
      let value = raw
      if (type === 1) value = raw + a
      else if (type === 2) value = raw + b
      else if (type === 3) value = raw + ((a + b) >> 1)
      else if (type === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      data[row + x] = value & 0xff
    }
  }
  return data.subarray(0, rowBytes * rows)
}

/** The picture's data for `ShrinkImage`. */
const sourceOf = (context: PDFContext, stream: PDFRawStream, read: Readable): ShrinkSource => {
  if (read.codec === 'DCTDecode') return { kind: 'jpeg', data: stream.contents }
  const { width, height, channels } = read
  // pdf-lib inflates but ignores predictors: strip DecodeParms and apply them here.
  const plain = stream.dict.clone(context)
  plain.delete(PDFName.of('DecodeParms'))
  const inflated = decodePDFRawStream(PDFRawStream.of(plain, stream.contents)).decode()
  const rowBytes = width * channels
  const data =
    read.predictor === 1
      ? inflated.subarray(0, rowBytes * height)
      : unfilterPng(inflated, rowBytes, channels, height)
  if (data.length < rowBytes * height) throw new Error('The image data is short.')
  return { kind: 'pixels', data, channels, width, height }
}

/**
 * Shrinks the pictures `page` draws, in its document, for a page drawn
 * `drawnLongPt` points along its long side (the largest anywhere in the
 * export). Each picture is re-encoded once per document (`done` holds
 * their keys); one that doesn't come out smaller is kept as it is. A
 * picture that can't be read is kept too: shrinking is never worth losing
 * content over.
 */
export const shrinkPageImages = async (
  page: PDFPage,
  drawnLongPt: number,
  compression: Compression,
  shrink: ShrinkImage,
  done: Set<string>,
) => {
  const context = page.doc.context
  for (const { ref, stream, read, info } of shrinkableImages(page)) {
    if (done.has(info.key)) continue
    done.add(info.key)
    const target = pdfImageTarget(info, drawnLongPt, compression)
    let out: Uint8Array
    try {
      const source = sourceOf(context, stream, read)
      out = await shrink({ source, ...target, quality: compression.quality })
    } catch {
      continue
    }
    const size = readJpegInfo(out)
    if (!size || out.length >= stream.contents.length) continue
    const dict = stream.dict.clone(context)
    for (const key of ['Filter', 'DecodeParms', 'Length']) {
      dict.delete(PDFName.of(key))
    }
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    dict.set(PDFName.of('Width'), PDFNumber.of(size.width))
    dict.set(PDFName.of('Height'), PDFNumber.of(size.height))
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
    // The canvas writes colour JPEGs: a grey picture comes back as RGB.
    if (size.components === 3 && components(context, dict.get(PDFName.of('ColorSpace'))) === 1) {
      dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
    } else if (size.components === 1) {
      dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'))
    }
    dict.set(PDFName.of('Length'), PDFNumber.of(out.length))
    context.assign(ref, PDFRawStream.of(dict, out))
  }
}

/**
 * The pictures each page of a PDF draws that the export could shrink, for
 * the size estimate: read once at import, by the export worker.
 */
export const listPdfImages = async (bytes: Uint8Array): Promise<PdfImageInfo[][]> => {
  // An empty password opens owner-password-only files, as the export does.
  const doc = await PDFDocument.load(bytes, { password: '', updateMetadata: false })
  return doc.getPages().map((page) => {
    try {
      return shrinkableImages(sanitizedPage(doc, page)).map(({ info }) => info)
    } catch {
      return []
    }
  })
}
