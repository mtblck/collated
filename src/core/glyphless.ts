import {
  PDFHexString,
  PDFName,
  PDFString,
  type PDFDict,
  type PDFDocument,
  type PDFRef,
} from '@cantoo/pdf-lib'
import {
  GLYPHLESS_ADVANCE,
  GLYPHLESS_ASCENT,
  GLYPHLESS_DESCENT,
  GLYPHLESS_TTF_BASE64,
} from './glyphlessFont'

const NAME = 'CollatedGlyphless'
/** Two-byte codes, and CID 0 is .notdef. */
const MAX_CID = 0xffff

/**
 * Combining marks (Hebrew points, Arabic vowels, accents given apart from
 * their letter) take no width, as in a real font, so readers measure a word
 * with them the same as without, and keep it in its line (#139).
 */
const ZERO_WIDTH = /[\p{Mn}\p{Me}]/u

const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')

/** A code point as UTF-16BE hex, the way a ToUnicode CMap names it. */
const utf16Hex = (codePoint: number) =>
  String.fromCodePoint(codePoint)
    .split('')
    .map((unit) => hex4(unit.charCodeAt(0)))
    .join('')

/**
 * The text layer's font for words the standard Helvetica can't write (#94):
 * Polish, Greek, Cyrillic, and any other script. Its glyphs are blank, which is
 * fine because OCR text is invisible (rendering mode 3); what makes the words
 * searchable and copyable is the ToUnicode CMap naming each character.
 *
 * It's a Type 0 font (Identity-H, two bytes per character) over an embedded
 * TrueType font (`scripts/make-glyphless-font.py`). Each document numbers the
 * characters it uses from 1 in the order they're first written, so any code
 * point fits, astral ones too, and the maps hold only those characters. Every
 * CID draws the same blank glyph, 500/1000 em wide.
 *
 * Embedded, so a PDF/A export (#116) could write every word in it. Call
 * `finish()` once all pages are drawn and before the document is encrypted or
 * saved: it writes the maps.
 */
export class GlyphlessFont {
  readonly ref: PDFRef
  readonly name = NAME
  private readonly doc: PDFDocument
  private readonly toUnicodeRef: PDFRef
  private readonly cidToGidRef: PDFRef
  private readonly cidFont: PDFDict
  private readonly cids = new Map<number, number>()
  private finished = false

  constructor(doc: PDFDocument) {
    this.doc = doc
    const { context } = doc
    const bytes = Uint8Array.from(atob(GLYPHLESS_TTF_BASE64), (c) => c.charCodeAt(0))
    const fontFile = context.register(context.flateStream(bytes, { Length1: bytes.length }))
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: NAME,
        // Symbolic: its glyphs aren't the standard Latin set.
        Flags: 4,
        FontBBox: [0, GLYPHLESS_DESCENT, GLYPHLESS_ADVANCE, GLYPHLESS_ASCENT],
        ItalicAngle: 0,
        Ascent: GLYPHLESS_ASCENT,
        Descent: GLYPHLESS_DESCENT,
        CapHeight: GLYPHLESS_ASCENT,
        StemV: 80,
        FontFile2: fontFile,
      }),
    )
    this.toUnicodeRef = context.nextRef()
    this.cidToGidRef = context.nextRef()
    this.cidFont = context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: NAME,
      CIDSystemInfo: {
        Registry: PDFString.of('Adobe'),
        Ordering: PDFString.of('Identity'),
        Supplement: 0,
      },
      FontDescriptor: descriptor,
      DW: GLYPHLESS_ADVANCE,
      CIDToGIDMap: this.cidToGidRef,
    })
    this.ref = context.register(
      context.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: NAME,
        Encoding: 'Identity-H',
        DescendantFonts: [context.register(this.cidFont)],
        ToUnicode: this.toUnicodeRef,
      }),
    )
  }

  /** Whether every character of `text` can still be given a code. */
  canEncode(text: string) {
    const fresh = new Set<number>()
    for (const ch of text) {
      const codePoint = ch.codePointAt(0) ?? 0
      if (!this.cids.has(codePoint)) fresh.add(codePoint)
    }
    return this.cids.size + fresh.size <= MAX_CID
  }

  /** `text` as two-byte codes; check `canEncode` first. */
  encodeText(text: string) {
    if (this.finished) throw new Error('GlyphlessFont: written after finish()')
    let out = ''
    for (const ch of text) {
      const codePoint = ch.codePointAt(0) ?? 0
      let cid = this.cids.get(codePoint)
      if (cid === undefined) {
        cid = this.cids.size + 1
        if (cid > MAX_CID) throw new Error('GlyphlessFont: out of codes')
        this.cids.set(codePoint, cid)
      }
      out += hex4(cid)
    }
    return PDFHexString.of(out)
  }

  /** Every character is the same width, but combining marks take none. */
  widthOfTextAtSize(text: string, size: number) {
    // Code points, as `encodeText` gives each one a code.
    const spacing = Array.from(text).filter((ch) => !ZERO_WIDTH.test(ch)).length
    return (spacing * GLYPHLESS_ADVANCE * size) / 1000
  }

  /** Writes the CMap and the CID-to-glyph map for the characters used. */
  finish() {
    if (this.finished) return
    this.finished = true
    const { context } = this.doc
    const entries = [...this.cids].map(
      ([codePoint, cid]) => `<${hex4(cid)}> <${utf16Hex(codePoint)}>`,
    )
    const blocks: string[] = []
    // A bfchar block holds at most 100 entries.
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100)
      blocks.push(`${chunk.length} beginbfchar\n${chunk.join('\n')}\nendbfchar`)
    }
    const cmap = [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def',
      '/CMapType 2 def',
      '1 begincodespacerange',
      '<0000> <FFFF>',
      'endcodespacerange',
      ...blocks,
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n')
    context.assign(this.toUnicodeRef, context.flateStream(cmap))
    const marks = [...this.cids]
      .filter(([codePoint]) => ZERO_WIDTH.test(String.fromCodePoint(codePoint)))
      .flatMap(([, cid]) => [cid, [0]])
    if (marks.length) this.cidFont.set(PDFName.of('W'), context.obj(marks))
    // CID n draws glyph 1 (the blank one); CID 0 stays .notdef.
    const map = new Uint8Array((this.cids.size + 1) * 2)
    for (let cid = 1; cid <= this.cids.size; cid++) map[cid * 2 + 1] = 1
    context.assign(this.cidToGidRef, context.flateStream(map))
  }
}
