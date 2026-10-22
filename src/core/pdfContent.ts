import { jpegEnd, stripJpegMetadata } from './jpegClean'

/**
 * A PDF content stream, read token by token (PDF 32000-1, 7.2 and 7.8): just
 * enough to find operators, their operands, marked-content sections and
 * inline images, never fooled by text inside strings or image data. Where
 * the spec leaves room, it reads as pdf.js (the preview) and poppler do.
 */

type Kind = 'name' | 'operator' | 'number' | 'string' | 'open' | 'close'

interface Token {
  kind: Kind
  start: number
  end: number
  /** Names decoded (#xx); operators, numbers and brackets as written. */
  text: string
}

/** An operand: what the tokens before an operator stand for. */
type Operand =
  | { name: string }
  | { number: number }
  | { ref: [number, number] }
  | { string: true }
  | Operand[]
  | Map<string, Operand>

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
    if (c === 0x5c) i++
    // A backslash escapes the next byte.
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

/**
 * Where an inline image's data ends when its encoding doesn't say: the first
 * "EI" followed by whitespace and then by what looks like content (text, not
 * binary), as pdf.js (the preview) decides. Null if there's none.
 */
const findEI = (b: Uint8Array, from: number) => {
  for (let i = from; i < b.length - 1; i++) {
    if (b[i] !== 0x45 || b[i + 1] !== 0x49) continue
    const after = b[i + 2]
    if (after === undefined) return i
    if (after !== 0x20 && after !== 0x0a && after !== 0x0d) continue
    let text = true
    for (let j = i + 3; j < Math.min(b.length, i + 18); j++) {
      const c = b[j] ?? 0
      if (c === 0 && b[j + 1] !== 0) continue
      if (c !== 0x0a && c !== 0x0d && (c < 0x20 || c > 0x7f)) {
        text = false
        break
      }
    }
    if (text) return i
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

const isInteger = (t: Token | undefined) => t?.kind === 'number' && /^\d+$/.test(t.text)

/**
 * Operands from their tokens: arrays and dictionaries grouped, "n g R"
 * read as a reference (as pdf.js's parser does). Unbalanced brackets end
 * the group where the tokens do.
 */
const parseOperands = (tokens: Token[]): Operand[] => {
  let i = 0
  const value = (): Operand | undefined => {
    const t = tokens[i++]
    if (!t) return undefined
    if (t.kind === 'name') return { name: t.text }
    if (t.kind === 'string') return { string: true }
    if (t.kind === 'number') {
      const g = tokens[i]
      const r = tokens[i + 1]
      if (isInteger(t) && isInteger(g) && r?.kind === 'operator' && r.text === 'R') {
        i += 2
        return { ref: [Number(t.text), Number(g?.text)] }
      }
      return { number: Number(t.text) }
    }
    if (t.kind === 'open' && t.text === '[') {
      const items: Operand[] = []
      while (i < tokens.length && !(tokens[i]?.kind === 'close' && tokens[i]?.text === ']')) {
        const item = value()
        if (item !== undefined) items.push(item)
      }
      i++
      return items
    }
    if (t.kind === 'open' && t.text === '<<') {
      const dict = new Map<string, Operand>()
      while (i < tokens.length && !(tokens[i]?.kind === 'close' && tokens[i]?.text === '>>')) {
        const key = tokens[i++]
        const entry = value()
        if (key?.kind === 'name' && entry !== undefined) dict.set(key.text, entry)
      }
      i++
      return dict
    }
    return undefined
  }
  const out: Operand[] = []
  while (i < tokens.length) {
    const v = value()
    if (v !== undefined) out.push(v)
  }
  return out
}

/** Pairs of key and value after "BI", up to "ID". */
const inlineDict = (tokens: Token[]) => {
  const dict = new Map<string, Operand>()
  const values = parseOperands(tokens)
  for (let i = 0; i + 1 < values.length; i += 2) {
    const key = values[i]
    const value = values[i + 1]
    if (key && value && !(key instanceof Map) && !Array.isArray(key) && 'name' in key) {
      dict.set(key.name, value)
    }
  }
  return dict
}

export interface InlineImage {
  /** "BI" … through "EI". */
  start: number
  end: number
  /** The image data: after "ID" and its whitespace, to where its encoding ends. */
  dataStart: number
  dataEnd: number
  /** Filter names, unabbreviated, outermost first. */
  filters: string[]
  /** Names its dictionary uses (a colour space can name a resource). */
  names: string[]
}

/**
 * Finds where an inline image's data ends. Only the encoding says that
 * reliably: a JPEG's end marker, the end of ASCII hex or base-85 text;
 * otherwise the first standalone "EI".
 */
const readInline = (b: Uint8Array, tokens: Token[], start: number, idEnd: number): InlineImage => {
  const dict = inlineDict(tokens)
  const filter = dict.get('F') ?? dict.get('Filter')
  const list = Array.isArray(filter) ? filter : filter ? [filter] : []
  const filters = list.map((f) =>
    f instanceof Map || Array.isArray(f) || !('name' in f)
      ? '?'
      : (ABBREVIATIONS[f.name] ?? f.name),
  )
  // One whitespace byte follows ID; some writers put CR LF, some nothing.
  let dataStart = idEnd
  if (b[idEnd] === 0x0d && b[idEnd + 1] === 0x0a) dataStart += 2
  else if (isWhite(b[idEnd])) dataStart += 1
  let encodedEnd: number | null = null
  const first = filters[0]
  if (first === 'DCTDecode') encodedEnd = jpegEnd(b, dataStart)
  else if (first === 'ASCIIHexDecode') {
    const gt = indexOf(b, [0x3e], dataStart)
    encodedEnd = gt < 0 ? null : gt + 1
  } else if (first === 'ASCII85Decode') {
    const tilde = indexOf(b, [0x7e, 0x3e], dataStart)
    encodedEnd = tilde < 0 ? null : tilde + 2
  }
  const ei = findEI(b, encodedEnd ?? dataStart)
  return {
    start,
    end: ei < 0 ? b.length : ei + 2,
    dataStart,
    dataEnd: encodedEnd ?? (ei < 0 ? b.length : Math.max(dataStart, ei - 1)),
    filters,
    names: tokens.filter((t) => t.kind === 'name').map((t) => t.text),
  }
}

type Item = { token: Token } | { inline: InlineImage } | { unterminated: number }

/** Every token, with inline images as one item each. */
function* items(b: Uint8Array): Generator<Item> {
  let i = 0
  let biStart = -1
  let biTokens: Token[] = []
  const emit = function* (token: Token): Generator<Item> {
    if (biStart >= 0) {
      if (token.kind === 'operator' && token.text === 'ID') {
        const inline = readInline(b, biTokens, biStart, token.end)
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
      yield* emit({ kind: 'string', start, end: i, text: '' })
      continue
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) {
        i += 2
        yield* emit({ kind: 'open', start, end: i, text: '<<' })
      } else {
        const gt = indexOf(b, [0x3e], i)
        i = gt < 0 ? b.length : gt + 1
        yield* emit({ kind: 'string', start, end: i, text: '' })
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
    // Inside an inline image's dictionary, "ID" ends it even with the data
    // run straight on ("ID00…"), as in pdf.js.
    if (biStart >= 0 && c === 0x49 && b[i + 1] === 0x44) {
      i += 2
      yield* emit({ kind: 'operator', start, end: i, text: 'ID' })
      continue
    }
    while (isRegular(b[i])) i++
    const text = latin1(b, start, i)
    const numeric = /^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)
    // true, false and null are operands, like strings for our purposes.
    const keyword = text === 'true' || text === 'false' || text === 'null'
    yield* emit({ kind: numeric ? 'number' : keyword ? 'string' : 'operator', start, end: i, text })
  }
  // An inline image that never reaches its data: nothing a viewer draws.
  if (biStart >= 0) yield { unterminated: biStart }
}

const latin1 = (b: Uint8Array, from: number, to: number) => {
  let out = ''
  for (let i = from; i < to; i++) out += String.fromCharCode(b[i] ?? 0)
  return out
}

/**
 * Whether the content marks anything with an optional-content dictionary
 * written in place (`/OC <<…>> BDC`) rather than named in its resources.
 */
export const hasInlineOC = (content: Uint8Array) => {
  let previous: Token | undefined
  for (const item of items(content)) {
    if (!('token' in item)) continue
    const { token } = item
    if (
      token.kind === 'open' &&
      token.text === '<<' &&
      previous?.kind === 'name' &&
      previous.text === 'OC'
    ) {
      return true
    }
    previous = token
  }
  return false
}

/** Every resource name the content uses: name operands and inline images' names. */
export const namesIn = (content: Uint8Array) => {
  const names = new Set<string>()
  for (const item of items(content)) {
    if ('inline' in item) for (const n of item.inline.names) names.add(n)
    else if ('token' in item && item.token.kind === 'name') names.add(item.token.text)
  }
  return names
}

export interface CleanedContent {
  bytes: Uint8Array
  /** Graphics states (q) and marked-content sections the content leaves open. */
  openStates: number
  openSections: number
}

/**
 * The content without metadata or what no viewer draws:
 * - inline JPEGs lose their metadata, and anything stored after the image;
 *   one wrapped in another encoding, or broken, is removed (it can't be
 *   cleaned without decoding it);
 * - anything after the last operator, or an unfinished inline image.
 * Everything else is copied byte for byte. (Hidden layers aren't handled
 * here: a page that hides anything is exported as the preview draws it.)
 */
export const cleanContent = (content: Uint8Array): CleanedContent => {
  const parts: Uint8Array[] = []
  let from = 0
  let changed = false as boolean // set inside `cut`
  let operandsStart = -1
  let sections = 0
  let states = 0

  const cut = (start: number, end: number, replacement?: Uint8Array) => {
    parts.push(content.subarray(from, start))
    if (replacement) parts.push(replacement)
    from = end
    changed = true
  }

  for (const item of items(content)) {
    if ('unterminated' in item) {
      cut(item.unterminated, content.length)
      continue
    }
    if ('inline' in item) {
      const image = item.inline
      operandsStart = -1
      if (!image.filters.includes('DCTDecode')) continue
      const jpeg = content.subarray(image.dataStart, image.dataEnd)
      const plain = image.filters.length === 1 && jpegEnd(jpeg, 0) === jpeg.length
      if (!plain) {
        cut(image.start, image.end)
        continue
      }
      const cleaned = stripJpegMetadata(jpeg)
      // Keep "BI … ID ", the cleaned JPEG, and a fresh "EI".
      const head = content.subarray(image.start, image.dataStart)
      if (cleaned !== jpeg || image.end - image.dataEnd !== 3) {
        cut(image.start, image.end, concat([head, cleaned, new Uint8Array([0x0a, 0x45, 0x49])]))
      }
      continue
    }
    const { token } = item
    if (token.kind !== 'operator') {
      if (operandsStart < 0) operandsStart = token.start
      continue
    }
    const op = token.text
    if (op === 'BDC' || op === 'BMC') sections++
    else if (op === 'EMC') sections = Math.max(0, sections - 1)
    else if (op === 'q') states++
    else if (op === 'Q') states = Math.max(0, states - 1)
    // "n g R" belongs to the operands; anything else ends them.
    if (op !== 'R') operandsStart = -1
  }
  // Operands with no operator after them: nothing a viewer draws.
  if (operandsStart >= 0) cut(operandsStart, content.length)
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
