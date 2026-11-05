import {
  PDFFont,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFontEmbedder,
  StandardFonts,
  type PDFContext,
  type PDFDocument,
  type PDFRef,
} from '@cantoo/pdf-lib'
import {
  ARCHIVE_ASCENT,
  ARCHIVE_BBOX,
  ARCHIVE_CAP_HEIGHT,
  ARCHIVE_DESCENT,
  ARCHIVE_FONT_NAME,
  ARCHIVE_ITALIC_ANGLE,
  ARCHIVE_TTF_BASE64,
  ARCHIVE_WIDTHS,
} from './archiveFontData'

/**
 * PDF/A-2b (ISO 19005-2, level B), for archiving (#116, ADR 0026): what a
 * plain export lacks is added here. The rest of the rules are kept by
 * `buildPdf` itself: every font embedded (this file's Arimo for visible text,
 * the glyphless font for OCR words), PDF pages drawn as pictures, no
 * password.
 */
export const PDFA_PART = 2
export const PDFA_CONFORMANCE = 'B'

/** Arimo's subset tag: six capitals, as PDF names an embedded subset. */
const BASE_FONT = `COLLAT+${ARCHIVE_FONT_NAME}`

/**
 * Visible text (marks, the watermark, page numbers) in an embedded font. It
 * encodes and measures exactly as the standard Helvetica does, so layout made
 * with Helvetica's metrics is unchanged, but the font it names is our Arimo
 * subset (scripts/make-archive-font.py), whose widths are Helvetica's for
 * all but a few rare characters (± · ÷ ¯ µ Ÿ ƒ).
 */
export const embedArchiveFont = async (doc: PDFDocument): Promise<PDFFont> => {
  // The same name in both enums; pdf-lib's own embedFont casts it too.
  const embedder = StandardFontEmbedder.for(
    StandardFonts.Helvetica as unknown as Parameters<typeof StandardFontEmbedder.for>[0],
  )
  // Measured by the font's own widths, which the PDF's /Widths match.
  const widthOf = (text: string, size: number) => {
    const codes = embedder.encodeText(text).asBytes()
    let total = 0
    for (const code of codes) total += ARCHIVE_WIDTHS[code - 32] ?? 0
    return (total * size) / 1000
  }
  Object.assign(embedder, {
    widthOfTextAtSize: widthOf,
    embedIntoContext: (context: PDFContext, ref?: PDFRef) => {
      const font = archiveFontDict(context)
      if (!ref) return context.register(font)
      context.assign(ref, font)
      return ref
    },
  })
  const font = PDFFont.of(doc.context.nextRef(), doc, embedder)
  await font.embed()
  return font
}

const archiveFontDict = (context: PDFContext) => {
  const bytes = Uint8Array.from(atob(ARCHIVE_TTF_BASE64), (c) => c.charCodeAt(0))
  const fontFile = context.register(context.flateStream(bytes, { Length1: bytes.length }))
  const descriptor = context.register(
    context.obj({
      Type: 'FontDescriptor',
      FontName: BASE_FONT,
      // Nonsymbolic: Latin text, read through WinAnsiEncoding.
      Flags: 32,
      FontBBox: ARCHIVE_BBOX,
      ItalicAngle: ARCHIVE_ITALIC_ANGLE,
      Ascent: ARCHIVE_ASCENT,
      Descent: ARCHIVE_DESCENT,
      CapHeight: ARCHIVE_CAP_HEIGHT,
      StemV: 80,
      FontFile2: fontFile,
    }),
  )
  return context.obj({
    Type: 'Font',
    Subtype: 'TrueType',
    BaseFont: BASE_FONT,
    FirstChar: 32,
    LastChar: 255,
    Widths: ARCHIVE_WIDTHS,
    Encoding: 'WinAnsiEncoding',
    FontDescriptor: descriptor,
  })
}

const s15Fixed16 = (view: DataView, at: number, value: number) => {
  view.setInt32(at, Math.round(value * 65536))
}

/**
 * A compact sRGB ICC profile (version 2.1, display class): the sRGB
 * primaries adapted to D50 (Bradford) and its tone curve, sampled. Ours,
 * computed from IEC 61966-2-1, so there's no profile file to licence.
 */
export const srgbProfile = (): Uint8Array => {
  const text = (sig: string, value: string) => {
    if (sig === 'desc') {
      // textDescriptionType: ASCII, then empty Unicode and ScriptCode parts.
      const ascii = value.length + 1
      const out = new Uint8Array(12 + ascii + 4 + 4 + 2 + 1 + 67)
      out.set(new TextEncoder().encode('desc'), 0)
      new DataView(out.buffer).setUint32(8, ascii)
      out.set(new TextEncoder().encode(value), 12)
      return out
    }
    const out = new Uint8Array(8 + value.length + 1)
    out.set(new TextEncoder().encode('text'), 0)
    out.set(new TextEncoder().encode(value), 8)
    return out
  }
  const xyz = (x: number, y: number, z: number) => {
    const out = new Uint8Array(20)
    const view = new DataView(out.buffer)
    out.set(new TextEncoder().encode('XYZ '), 0)
    s15Fixed16(view, 8, x)
    s15Fixed16(view, 12, y)
    s15Fixed16(view, 16, z)
    return out
  }
  const POINTS = 1024
  const curve = new Uint8Array(12 + POINTS * 2)
  {
    const view = new DataView(curve.buffer)
    curve.set(new TextEncoder().encode('curv'), 0)
    view.setUint32(8, POINTS)
    for (let i = 0; i < POINTS; i++) {
      const v = i / (POINTS - 1)
      const linear = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      view.setUint16(12 + i * 2, Math.round(linear * 65535))
    }
  }
  const tags: [string, Uint8Array][] = [
    ['desc', text('desc', 'sRGB IEC61966-2.1')],
    ['cprt', text('text', 'No copyright, use freely')],
    ['wtpt', xyz(0.9642, 1, 0.8249)],
    ['rXYZ', xyz(0.436066, 0.222488, 0.013916)],
    ['gXYZ', xyz(0.385147, 0.716873, 0.097076)],
    ['bXYZ', xyz(0.143066, 0.060608, 0.714096)],
    // One curve, shared by the three channels.
    ['rTRC', curve],
    ['gTRC', curve],
    ['bTRC', curve],
  ]
  const pad = (n: number) => (n + 3) & ~3
  const tableEnd = 128 + 4 + tags.length * 12
  const offsets = new Map<Uint8Array, number>()
  let size = tableEnd
  for (const [, data] of tags) {
    if (offsets.has(data)) continue
    offsets.set(data, size)
    size = pad(size + data.length)
  }
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  const ascii = (at: number, value: string) => {
    out.set(new TextEncoder().encode(value), at)
  }
  view.setUint32(0, size)
  view.setUint32(8, 0x02100000)
  ascii(12, 'mntr')
  ascii(16, 'RGB ')
  ascii(20, 'XYZ ')
  // Date: 2026-11-05, fixed so the bytes are the same in every file.
  ;[2026, 11, 5, 0, 0, 0].forEach((v, i) => {
    view.setUint16(24 + i * 2, v)
  })
  ascii(36, 'acsp')
  view.setUint32(64, 0) // perceptual
  s15Fixed16(view, 68, 0.9642)
  s15Fixed16(view, 72, 1)
  s15Fixed16(view, 76, 0.8249)
  view.setUint32(128, tags.length)
  tags.forEach(([sig, data], i) => {
    const at = 132 + i * 12
    ascii(at, sig)
    view.setUint32(at + 4, offsets.get(data) ?? 0)
    view.setUint32(at + 8, data.length)
  })
  for (const [data, at] of offsets) out.set(data, at)
  return out
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Characters XML 1.0 can't hold at all.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')

/** The date as XMP writes it, to the second, in UTC, matching the Info dictionary's. */
const xmpDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * The XMP metadata PDF/A requires: its part and level, and the same title,
 * tool and dates as the document information dictionary (which veraPDF
 * compares).
 */
export const xmpPacket = (info: { title: string; tool: string; date: Date }) => {
  const date = xmpDate(info.date)
  const title = info.title
    ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(info.title)}</rdf:li></rdf:Alt></dc:title>`
    : ''
  const tool = escapeXml(info.tool)
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    `<pdfaid:part>${String(PDFA_PART)}</pdfaid:part>`,
    `<pdfaid:conformance>${PDFA_CONFORMANCE}</pdfaid:conformance>`,
    '<dc:format>application/pdf</dc:format>',
    title,
    `<xmp:CreatorTool>${tool}</xmp:CreatorTool>`,
    `<xmp:CreateDate>${date}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${date}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${date}</xmp:MetadataDate>`,
    `<pdf:Producer>${tool}</pdf:Producer>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Makes the document PDF/A-2b once its pages are drawn: XMP metadata, the
 * sRGB output intent (every colour in the file is RGB or grey) and a file
 * identifier. Call it last, before saving; never on an encrypted document.
 */
export const makeArchival = (
  doc: PDFDocument,
  info: { title: string; tool: string; date: Date },
) => {
  const { context, catalog } = doc
  const metadata = context.register(
    // Uncompressed, so tools that don't parse PDF can still find it.
    // UTF-8, copied into this realm's Uint8Array (pdf-lib checks the type).
    context.stream(Uint8Array.from(new TextEncoder().encode(xmpPacket(info))), {
      Type: 'Metadata',
      Subtype: 'XML',
    }),
  )
  catalog.set(PDFName.of('Metadata'), metadata)
  const profile = context.register(context.flateStream(srgbProfile(), { N: 3 }))
  const intent = context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    RegistryName: PDFString.of('http://www.color.org'),
    DestOutputProfile: profile,
  })
  catalog.set(PDFName.of('OutputIntents'), context.obj([intent]))
  const id = new Uint8Array(16)
  crypto.getRandomValues(id)
  const hex = PDFHexString.of(Array.from(id, (b) => b.toString(16).padStart(2, '0')).join(''))
  context.trailerInfo.ID = context.obj([hex, hex])
}
