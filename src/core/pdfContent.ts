import { jpegEnd, stripJpegMetadata } from './jpegClean'

/**
 * A PDF content stream, read token by token (PDF 32000-1, 7.2 and 7.8): just
 * enough to find operators, their operands, marked-content sections and
 * inline images, never fooled by text inside strings or image data.
 */

type Kind = 'name' | 'operator' | 'other' | 'open' | 'close'

interface Token {
  kind: Kind
  start: number
  end: number
  /** Names decoded (#xx), operators as written. */
  text: string
}

const WHITE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])

const isWhite = (b: number | undefined) => b !== undefined && WHITE.has(b)
const isRegular = (b: number | undefined) => b !== undefined && !WHITE.has(b) && !DELIM.has(b)

const decodeName = (raw: string) =>
  raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

/** Where a literal string starting at `i` (its "(") ends, just after ")". */
const stringEnd = (b: Uint8Array, i: number) => {
  let depth = 0
  for (; i < b.length; i++) {
    const c = b[i]
    if (c === 0x5c)
      i++ // backslash escapes the next byte
    else if (c === 0x28) depth++
    else if (c === 0x29 && --depth === 0) return i + 1
  }
  return b.length
}

const indexOf = (b: Uint8Array, bytes: number[], from: number) => {
  outer: for (let i = from; i <= b.length - bytes.length; i++) {
    for (let j = 0; j < bytes.length; j++) if (b[i + j] !== bytes[j]) continue outer
    return i
  }
  return -1
}

/** The first "EI" at or after `from` that stands as a token (whitespace before, delimiter after). */
const findEI = (b: Uint8Array, from: number) => {
  for (let i = Math.max(from, 1); i < b.length - 1; i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x49 && isWhite(b[i - 1]) && !isRegular(b[i + 2])) return i
  }
  return -1
}

const ABBREVIATIONS: Record<string, string> = {
  AHx: 'ASCIIHexDecode',
  A85: 'ASCII85Decode',
  LZW: 'LZWDecode',
  Fl: 'FlateDecode',
  RL: 'RunLengthDecode',
  CCF: 'CCITTFaxDecode',
  DCT: 'DCTDecode',
}

export interface InlineImage {
  /** "BI" … through "EI". */
  start: number
  end: number
  /** The bytes between "ID" and its single whitespace, and "EI". */
  dataStart: number
  dataEnd: number
  /** Filter names, unabbreviated, outermost first. */
  filters: string[]
}

/**
 * Reads an inline image's dictionary (tokens after "BI") and finds where its
 * data ends. Only the encoding says that reliably: a JPEG's end marker, the
 * end of ASCII hex or base-85 text; otherwise the first standalone "EI".
 */
const readInline = (b: Uint8Array, tokens: Token[], start: number, id: Token): InlineImage => {
  const filters: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i]
    if (key?.kind !== 'name' || (key.text !== 'F' && key.text !== 'Filter')) continue
    const value = tokens[i + 1]
    if (value?.kind === 'name') filters.push(value.text)
    else if (value?.kind === 'open' && value.text === '[') {
      for (let j = i + 2; j < tokens.length && tokens[j]?.kind === 'name'; j++) {
        filters.push(tokens[j]?.text ?? '')
      }
    }
    break
  }
  const names = filters.map((f) => ABBREVIATIONS[f] ?? f)
  // One whitespace byte follows ID; some writers put CR LF.
  let dataStart = id.end + 1
  if (b[id.end] === 0x0d && b[id.end + 1] === 0x0a) dataStart++
  let encodedEnd: number | null = null
  const first = names[0]
  if (first === 'DCTDecode') encodedEnd = jpegEnd(b, dataStart)
  else if (first === 'ASCIIHexDecode') {
    const gt = indexOf(b, [0x3e], dataStart)
    encodedEnd = gt < 0 ? null : gt + 1
  } else if (first === 'ASCII85Decode') {
    const tilde = indexOf(b, [0x7e, 0x3e], dataStart)
    encodedEnd = tilde < 0 ? null : tilde + 2
  }
  const ei = findEI(b, encodedEnd ?? dataStart)
  const end = ei < 0 ? b.length : ei + 2
  return {
    start,
    end,
    dataStart,
    dataEnd: encodedEnd ?? (ei < 0 ? b.length : ei - 1),
    filters: names,
  }
}

type Item = { token: Token } | { inline: InlineImage }

/** Every token, with inline images as one item each. */
function* items(b: Uint8Array): Generator<Item> {
  let i = 0
  let biStart = -1
  let biTokens: Token[] = []
  const emit = function* (token: Token): Generator<Item> {
    if (biStart >= 0) {
      if (token.kind === 'operator' && token.text === 'ID') {
        const inline = readInline(b, biTokens, biStart, token)
        biStart = -1
        biTokens = []
        i = inline.end
        yield { inline }
      } else biTokens.push(token)
      return
    }
    if (token.kind === 'operator' && token.text === 'BI') {
      biStart = token.start
      return
    }
    yield { token }
  }
  while (i < b.length) {
    const c = b[i] ?? 0
    const start = i
    if (WHITE.has(c)) {
      i++
      continue
    }
    if (c === 0x25) {
      while (i < b.length && b[i] !== 0x0a && b[i] !== 0x0d) i++
      continue
    }
    if (c === 0x28) {
      i = stringEnd(b, i)
      yield* emit({ kind: 'other', start, end: i, text: '' })
      continue
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) {
        i += 2
        yield* emit({ kind: 'open', start, end: i, text: '<<' })
      } else {
        const gt = indexOf(b, [0x3e], i)
        i = gt < 0 ? b.length : gt + 1
        yield* emit({ kind: 'other', start, end: i, text: '' })
      }
      continue
    }
    if (c === 0x3e) {
      i += b[i + 1] === 0x3e ? 2 : 1
      yield* emit({ kind: 'close', start, end: i, text: '>>' })
      continue
    }
    if (c === 0x5b || c === 0x7b) {
      i++
      yield* emit({ kind: 'open', start, end: i, text: String.fromCharCode(c) })
      continue
    }
    if (c === 0x5d || c === 0x7d || c === 0x29) {
      i++
      yield* emit({ kind: 'close', start, end: i, text: String.fromCharCode(c) })
      continue
    }
    if (c === 0x2f) {
      i++
      while (isRegular(b[i])) i++
      yield* emit({ kind: 'name', start, end: i, text: decodeName(latin1(b, start + 1, i)) })
      continue
    }
    while (isRegular(b[i])) i++
    const text = latin1(b, start, i)
    const numeric = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text) || text === 'true' || text === 'false'
    yield* emit({ kind: numeric || text === 'null' ? 'other' : 'operator', start, end: i, text })
  }
}

const latin1 = (b: Uint8Array, from: number, to: number) => {
  let out = ''
  for (let i = from; i < to; i++) out += String.fromCharCode(b[i] ?? 0)
  return out
}

export interface CleanedContent {
  bytes: Uint8Array
  /** Graphics states (q) and marked-content sections the content leaves open. */
  openStates: number
  openSections: number
}

/**
 * The content without what a viewer wouldn't show or what carries metadata:
 * - marked-content sections in a hidden layer (`/OC /name BDC … EMC`, where
 *   `hidden(name)` says so), removed whole;
 * - inline JPEGs lose their metadata, and anything stored after the image;
 *   one wrapped in another encoding, or broken, is removed (it can't be
 *   cleaned without decoding it).
 * Everything else is copied byte for byte.
 */
export const cleanContent = (
  content: Uint8Array,
  hidden: (propertiesName: string) => boolean,
): CleanedContent => {
  const parts: Uint8Array[] = []
  let from = 0
  let changed = false as boolean // set inside `cut`
  // Start of the current operator's operands, and the names among them.
  let operandsStart = -1
  let operands: Token[] = []
  let skipDepth = 0 // > 0: inside a hidden section, this many levels deep
  let skipFrom = 0
  let sections = 0
  let states = 0

  const cut = (start: number, end: number, replacement?: Uint8Array) => {
    parts.push(content.subarray(from, start))
    if (replacement) parts.push(replacement)
    from = end
    changed = true
  }

  for (const item of items(content)) {
    if ('inline' in item) {
      const image = item.inline
      operandsStart = -1
      operands = []
      if (skipDepth > 0 || !image.filters.includes('DCTDecode')) continue
      const jpeg = content.subarray(image.dataStart, image.dataEnd)
      const plain = image.filters.length === 1 && jpegEnd(jpeg, 0) === jpeg.length
      if (!plain) {
        cut(image.start, image.end)
        continue
      }
      const cleaned = stripJpegMetadata(jpeg)
      // Keep "BI … ID ", the cleaned JPEG, and a fresh "EI".
      const head = content.subarray(image.start, image.dataStart)
      const tail = new Uint8Array([0x0a, 0x45, 0x49])
      if (cleaned !== jpeg || image.end - image.dataEnd !== 3) {
        cut(image.start, image.end, concat([head, cleaned, tail]))
      }
      continue
    }
    const { token } = item
    if (token.kind !== 'operator') {
      if (operandsStart < 0) operandsStart = token.start
      operands.push(token)
      continue
    }
    const op = token.text
    if (skipDepth > 0) {
      if (op === 'BDC' || op === 'BMC') skipDepth++
      else if (op === 'EMC' && --skipDepth === 0) cut(skipFrom, token.end)
    } else if (op === 'BDC') {
      const [tag, props] = operands
      if (
        tag?.kind === 'name' &&
        tag.text === 'OC' &&
        props?.kind === 'name' &&
        hidden(props.text)
      ) {
        skipDepth = 1
        skipFrom = operandsStart
      } else sections++
    } else if (op === 'BMC') sections++
    else if (op === 'EMC') sections = Math.max(0, sections - 1)
    else if (op === 'q') states++
    else if (op === 'Q') states = Math.max(0, states - 1)
    operandsStart = -1
    operands = []
  }
  // A hidden section left open runs to the end.
  if (skipDepth > 0) cut(skipFrom, content.length)
  if (!changed) return { bytes: content, openStates: states, openSections: sections }
  parts.push(content.subarray(from))
  return { bytes: concat(parts), openStates: states, openSections: sections }
}

export const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
