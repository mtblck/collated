/**
 * A JPEG with everything but the picture removed: EXIF (camera, time, GPS),
 * XMP, IPTC/Photoshop, comments, multi-picture extensions and anything after
 * the image ends (phones append depth maps and previews there). The coded
 * image data is copied byte for byte, so this is lossless.
 *
 * Kept: JFIF (APP0), ICC colour profiles (APP2 "ICC_PROFILE"), Adobe (APP14,
 * which says how to interpret the colour channels), and every segment needed
 * to decode. Orientation lives in EXIF, but PDF viewers ignore it anyway: the
 * export applies it as a rotation (`storedTurns`).
 *
 * Returns the input unchanged if it doesn't start like a JPEG, so a strange
 * file fails in the embedder with its usual error. If it starts like one but
 * breaks off (no end marker, a bad length), what was read so far is cleaned
 * and the rest kept as it is: metadata comes first in practice, so a damaged
 * file still loses it. Stray bytes between segments are skipped, as decoders do.
 */
export const stripJpegMetadata = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const out: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  const at = (n: number) => bytes[n] ?? 0

  while (i < bytes.length) {
    if (at(i) !== 0xff) {
      // Stray bytes between segments: decoders skip to the next marker, so do we.
      while (i < bytes.length && at(i) !== 0xff) i++
      continue
    }
    // Fill bytes before a marker are allowed.
    while (at(i + 1) === 0xff) i++
    const marker = at(i + 1)
    if (marker === 0xd9) {
      out.push(bytes.subarray(i, i + 2))
      return concat(out)
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    const length = (at(i + 2) << 8) | at(i + 3)
    const end = i + 2 + length
    if (length < 2 || end > bytes.length) return concat([...out, bytes.subarray(i)])
    if (keep(bytes, marker, i + 4, end)) out.push(bytes.subarray(i, end))
    i = end
    if (marker === 0xda) {
      // Entropy-coded data runs to the next marker that isn't a stuffed zero
      // or a restart marker. Progressive JPEGs have several scans.
      const start = i
      while (i < bytes.length) {
        if (at(i) === 0xff) {
          const next = at(i + 1)
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break
        }
        i++
      }
      out.push(bytes.subarray(start, i))
    }
  }
  // No end-of-image marker: everything read is kept, cleaned.
  return concat(out)
}

const startsWith = (bytes: Uint8Array, from: number, end: number, text: string) => {
  if (end - from < text.length) return false
  for (let k = 0; k < text.length; k++) if (bytes[from + k] !== text.charCodeAt(k)) return false
  return true
}

const keep = (bytes: Uint8Array, marker: number, data: number, end: number) => {
  if (marker === 0xfe) return false // comment
  if (marker >= 0xe0 && marker <= 0xef) {
    if (marker === 0xe0) return startsWith(bytes, data, end, 'JFIF\0')
    if (marker === 0xe2) return startsWith(bytes, data, end, 'ICC_PROFILE\0')
    if (marker === 0xee) return startsWith(bytes, data, end, 'Adobe')
    return false
  }
  return true
}

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Where the JPEG starting at `start` ends (just after its end-of-image
 * marker), or null if it doesn't parse. For JPEGs inside other data, such as
 * an inline image in a PDF content stream, where only the JPEG's own
 * structure says where it stops.
 */
export const jpegEnd = (bytes: Uint8Array, start = 0): number | null => {
  const at = (n: number) => bytes[n] ?? 0
  if (at(start) !== 0xff || at(start + 1) !== 0xd8) return null
  let i = start + 2
  while (i < bytes.length) {
    if (at(i) !== 0xff) return null
    while (at(i + 1) === 0xff) i++
    const marker = at(i + 1)
    if (marker === 0xd9) return i + 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const end = i + 2 + ((at(i + 2) << 8) | at(i + 3))
    if (end > bytes.length || end <= i + 3) return null
    i = end
    if (marker === 0xda) {
      while (i < bytes.length) {
        if (at(i) === 0xff) {
          const next = at(i + 1)
          if (next !== 0x00 && !(next >= 0xd0 && next <= 0xd7) && next !== 0xff) break
        }
        i++
      }
    }
  }
  return null
}

/**
 * JPEG 2000 boxes that hold only metadata (ISO 15444-1 I.7, 15444-2 M.11):
 * XML (XMP), UUID (EXIF, XMP), URLs, rights, and association boxes, which
 * group labels and XML with what they describe.
 */
const JP2_METADATA = new Set(['xml ', 'uuid', 'uinf', 'ipr ', 'asoc', 'lbl '])

/**
 * A JPEG 2000 codestream without comment (COM) segments in its main header,
 * where encoders put free text. Tile-part headers are left alone (encoders
 * don't write comments there in practice). Null if the header can't be read.
 */
const stripCodestreamComments = (bytes: Uint8Array): Uint8Array | null => {
  if (bytes[0] !== 0xff || bytes[1] !== 0x4f) return null
  const out: Uint8Array[] = [bytes.subarray(0, 2)]
  let dropped = false
  for (let i = 2; ;) {
    if (i + 2 > bytes.length || bytes[i] !== 0xff) return null
    const marker = bytes[i + 1] ?? 0
    // SOT: the main header is over; the rest is tile data. (EOC: no tiles.)
    if (marker === 0x90 || marker === 0xd9) {
      out.push(bytes.subarray(i))
      return dropped ? concat(out) : bytes
    }
    if (i + 4 > bytes.length) return null
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
    if (length < 2 || i + 2 + length > bytes.length) return null
    if (marker === 0x64) dropped = true
    else out.push(bytes.subarray(i, i + 2 + length))
    i += 2 + length
  }
}

/**
 * A JPEG 2000 image without its metadata: in a JP2/JPX file, the metadata
 * boxes go and the codestream loses its comments; a bare codestream loses
 * its comments. A few stray bytes after the last box (a PDF stream length
 * that counts the line end) are dropped. Anything else gives null: it can't
 * be checked.
 */
export const stripJp2Metadata = (bytes: Uint8Array): Uint8Array | null => {
  if (bytes[0] === 0xff && bytes[1] === 0x4f) return stripCodestreamComments(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const signature =
    bytes.length >= 12 && view.getUint32(0) === 12 && view.getUint32(4) === 0x6a502020
  if (!signature) return null
  const kept: Uint8Array[] = []
  let dropped = false
  for (let i = 0; i < bytes.length;) {
    if (i + 8 > bytes.length) {
      // Trailing bytes too short to be a box.
      dropped = true
      break
    }
    let size = view.getUint32(i)
    let header = 8
    if (size === 1) {
      if (i + 16 > bytes.length) return null
      size = Number(view.getBigUint64(i + 8))
      header = 16
    } else if (size === 0) size = bytes.length - i
    if (size < header || i + size > bytes.length) return null
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    if (JP2_METADATA.has(type)) dropped = true
    else if (type === 'jp2c') {
      const stream = bytes.subarray(i + header, i + size)
      const cleaned = stripCodestreamComments(stream)
      if (!cleaned) return null
      if (cleaned === stream) kept.push(bytes.subarray(i, i + size))
      else {
        const box = new Uint8Array(8 + cleaned.length)
        new DataView(box.buffer).setUint32(0, box.length)
        box.set(bytes.subarray(i + 4, i + 8), 4)
        box.set(cleaned, 8)
        kept.push(box)
        dropped = true
      }
    } else kept.push(bytes.subarray(i, i + size))
    i += size
  }
  return dropped ? concat(kept) : bytes
}
