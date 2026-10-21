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
