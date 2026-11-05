/**
 * TIFF decoding (#113) with UTIF.js (MIT), run in `tiff.worker.ts`; apart
 * from it so it's tested in Node. No browser but Safari reads TIFF, and none
 * page by page.
 *
 * Black-and-white pages (fax, most office scanners) come back as 1-bit PNGs
 * and stay 1-bit into the PDF; everything else comes back as upright RGBA
 * for the page to encode. Either way the pixels are square: a standard-
 * resolution fax (204 × 98 dpi) has each row repeated.
 */
import * as UTIF from 'utif2'
import { MAX_IMPORT_PIXELS } from '../core/limits'
import { encodePng1 } from '../core/png'
import {
  MAX_TIFF_PAGES,
  isPage,
  planPage,
  readTiffHeader,
  reshape,
  tag,
  tiffResolution,
  unpackBits,
  type Ifd,
} from '../core/tiff'
import type { TiffPage, TiffResponse } from './tiffProtocol'

/** The decoder's own IFD reader, so we walk the page chain ourselves (see open). */
interface Internals {
  _binLE: unknown
  _binBE: unknown
  _readIFD: (
    bin: unknown,
    data: Uint8Array,
    offset: number,
    out: Ifd[],
    depth: number,
    options: { parseMN: boolean; debug: boolean },
  ) => unknown
  decodeImage: (buffer: ArrayBuffer, ifd: Ifd, ifds: Ifd[]) => void
  toRGBA8: (ifd: Ifd) => Uint8Array
}
const utif = UTIF as unknown as Internals

let file: { buffer: ArrayBuffer; ifds: Ifd[] } | undefined

/**
 * Reads every page's tags. UTIF's own decode() follows the IFD chain with
 * no end, so a file whose last page points back at its first would spin
 * forever; core/tiff.ts walks the chain (looped or not, capped) and UTIF
 * reads each IFD it found.
 */
export const openTiff = (buffer: ArrayBuffer): TiffResponse => {
  file = undefined
  const data = new Uint8Array(buffer)
  const header = readTiffHeader(data)
  if (!header.ok) {
    return {
      ok: false,
      message: `TIFF: ${header.reason}`,
      reason: header.reason === 'not-tiff' ? 'damaged' : header.reason,
    }
  }
  const bin = header.little ? utif._binLE : utif._binBE
  const ifds: Ifd[] = []
  for (const offset of header.offsets) {
    utif._readIFD(bin, data, offset, ifds, 0, { parseMN: false, debug: false })
  }
  const pages = ifds.filter(isPage)
  if (pages.length === 0) return { ok: false, message: 'TIFF has no pages', reason: 'no-pages' }
  if (pages.length > MAX_TIFF_PAGES) {
    return { ok: false, message: 'TIFF has too many pages', reason: 'too-many-pages' }
  }
  file = { buffer, ifds: pages }
  return { ok: true, type: 'open', pages: pages.length }
}

/** Lets go of the open file, so a big scan isn't held for the rest of the session. */
export const closeTiff = (): TiffResponse => {
  file = undefined
  return { ok: true, type: 'close' }
}

export const decodeTiffPage = (index: number): TiffResponse => {
  if (!file) throw new Error('No TIFF is open.')
  const ifd = file.ifds[index]
  if (!ifd) throw new Error(`No page ${String(index)} in this TIFF.`)
  const width = tag(ifd, 256, 0)
  const height = tag(ifd, 257, 0)
  const orientation = tag(ifd, 274, 1)
  const plan = planPage(width, height, orientation, tiffResolution(ifd))
  // From the tags, before decoding allocates anything for the pixels.
  for (const size of [{ width, height }, plan]) {
    if (!(size.width > 0 && size.height > 0) || size.width * size.height > MAX_IMPORT_PIXELS) {
      return {
        ok: false,
        message: `TIFF page claims ${String(size.width)}×${String(size.height)}`,
        tooLarge: size,
      }
    }
  }
  utif.decodeImage(file.buffer, ifd, file.ifds)
  const data = ifd.data
  if (!(data instanceof Uint8Array)) throw new Error('The TIFF decoder returned no pixels.')
  const samples = tag(ifd, 277, 1)
  const bits = tag(ifd, 258, 1)
  const compression = tag(ifd, 259, 1)
  // A 1-bit page without a photometric is read as fax's WhiteIsZero, as UTIF does.
  const onebit = bits === 1 || compression === 3 || compression === 4
  const photometric = tag(ifd, 262, onebit ? 0 : 2)
  let page: TiffPage
  if (onebit && samples === 1 && (photometric === 0 || photometric === 1)) {
    const pixels = unpackBits(data, width, height, photometric === 0)
    const upright = reshape(pixels, width, height, orientation, plan, (n) => new Uint8Array(n))
    const bytes = encodePng1(upright, plan.width, plan.height) as Uint8Array<ArrayBuffer>
    page = { kind: 'png', bytes, ...plan }
  } else {
    // What toRGBA8 reads after decodeImage (JPEG pages become RGB, 2).
    if (![0, 1, 2, 3, 5].includes(tag(ifd, 262, 2))) {
      return {
        ok: false,
        message: `TIFF photometric ${String(tag(ifd, 262, 2))}`,
        reason: 'colour',
      }
    }
    const rgba = utif.toRGBA8(ifd)
    const words = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height)
    const upright = reshape(words, width, height, orientation, plan, (n) => new Uint32Array(n))
    const pixels = new Uint8ClampedArray(
      upright.buffer,
      upright.byteOffset,
      plan.width * plan.height * 4,
    )
    page = { kind: 'rgba', pixels: pixels as Uint8ClampedArray<ArrayBuffer>, ...plan }
  }
  // The decoded strips aren't needed again; let them go before the next page.
  delete ifd.data
  return { ok: true, type: 'page', page }
}
