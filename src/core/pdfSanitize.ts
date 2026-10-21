import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib'
import { stripJpegMetadata } from './jpegClean'

/**
 * A copy of a source page that carries only what draws it: its content and
 * the resources that content names. Embedding a page as-is copies its whole
 * dictionary — comments, form fields, actions, thumbnails, metadata — and its
 * whole resource dictionary, which many scanners share across every page, so
 * one kept page would carry all the others' images. Image metadata (XMP, and
 * EXIF inside JPEG data) is removed too.
 *
 * What the content itself draws outside the visible box is still there (it's
 * one stream); the export clips it away, like any viewer would.
 */
export const sanitizedPage = (doc: PDFDocument, page: PDFPage): PDFPage => {
  const context = doc.context
  const source = page.node
  const resources = source.Resources()
  // The reference, not the resolved stream: streams must stay indirect.
  const contents = source.get(PDFName.of('Contents'))
  const content = contents ? decodeContents(context, contents) : new Uint8Array()
  const scrub = new Scrubber(context)
  const leaf = PDFPageLeaf.fromMapWithContext(new Map(), context, false)
  leaf.set(PDFName.of('Type'), PDFName.of('Page'))
  leaf.set(PDFName.of('MediaBox'), source.MediaBox())
  const crop = source.CropBox()
  if (crop) leaf.set(PDFName.of('CropBox'), crop)
  const rotate = source.Rotate()
  if (rotate) leaf.set(PDFName.of('Rotate'), rotate)
  if (contents) leaf.set(PDFName.of('Contents'), contents)
  leaf.set(
    PDFName.of('Resources'),
    resources ? scrub.prunedCopy(resources, content) : context.obj({}),
  )
  return PDFPage.of(leaf, context.register(leaf), doc)
}

const RESOURCE_KINDS = [
  'Font',
  'XObject',
  'ExtGState',
  'ColorSpace',
  'Pattern',
  'Shading',
  'Properties',
] as const

/** Every /Name token in a content stream, decoded. Over-inclusive is safe. */
export const namesIn = (content: Uint8Array) => {
  const text = latin1(content)
  const names = new Set<string>()
  for (const match of text.matchAll(/\/([^\s/[\]()<>{}%]*)/g)) {
    names.add(
      (match[1] ?? '').replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      ),
    )
  }
  return names
}

const latin1 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return out
}

const decodeStream = (stream: PDFStream) =>
  stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents()

const decodeContents = (context: PDFContext, contents: PDFObject): Uint8Array => {
  const resolved = context.lookup(contents)
  if (resolved instanceof PDFStream) return decodeStream(resolved)
  if (resolved instanceof PDFArray) {
    const parts = resolved.asArray().map((item) => decodeContents(context, item))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0))
    let offset = 0
    for (const p of parts) {
      out.set(p, offset)
      offset += p.length + 1
      out[offset - 1] = 0x0a
    }
    return out
  }
  return new Uint8Array()
}

class Scrubber {
  private readonly done = new Set<PDFRef>()

  constructor(private readonly context: PDFContext) {}

  /**
   * A new resource dictionary holding only entries `content` names. Forms
   * without their own resources use the page's, so their names count too.
   */
  prunedCopy(resources: PDFDict, content: Uint8Array): PDFDict {
    const used = namesIn(content)
    this.inheritedNames(resources, used)
    const out = this.context.obj({})
    for (const [key, value] of resources.entries()) {
      const kind = key.decodeText()
      if (!(RESOURCE_KINDS as readonly string[]).includes(kind)) {
        // ProcSet and anything unknown: small, kept as is.
        out.set(key, value)
        continue
      }
      const dict = this.context.lookupMaybe(value, PDFDict)
      if (!dict) continue
      const kept = this.context.obj({})
      for (const [name, entry] of dict.entries()) {
        if (!used.has(name.decodeText())) continue
        kept.set(name, entry)
        this.scrub(entry)
      }
      if (kept.keys().length) out.set(key, kept)
    }
    return out
  }

  /** Adds names used by forms (transitively) that fall back on these resources. */
  private inheritedNames(resources: PDFDict, used: Set<string>) {
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) return
    const seen = new Set<string>()
    let grew = true
    while (grew) {
      grew = false
      for (const [name, ref] of xobjects.entries()) {
        const key = name.decodeText()
        if (!used.has(key) || seen.has(key)) continue
        seen.add(key)
        const form = this.context.lookup(ref)
        if (!(form instanceof PDFStream) || !isForm(form) || form.dict.has(PDFName.of('Resources')))
          continue
        for (const n of namesIn(decodeStream(form))) {
          if (!used.has(n)) {
            used.add(n)
            grew = true
          }
        }
      }
    }
  }

  /** Removes metadata from a kept resource, and prunes nested resources. */
  private scrub(entry: PDFObject) {
    if (!(entry instanceof PDFRef)) return
    if (this.done.has(entry)) return
    this.done.add(entry)
    const object = this.context.lookup(entry)
    if (!(object instanceof PDFStream)) return
    const dict = object.dict
    dict.delete(PDFName.of('Metadata'))
    dict.delete(PDFName.of('PieceInfo'))
    if (isImage(dict)) {
      const mask = dict.get(PDFName.of('SMask'))
      if (mask) this.scrub(mask)
      if (object instanceof PDFRawStream && isPlainJpeg(dict)) {
        const cleaned = stripJpegMetadata(object.contents)
        if (cleaned !== object.contents) {
          dict.set(PDFName.of('Length'), PDFNumber.of(cleaned.length))
          this.context.assign(entry, PDFRawStream.of(dict, cleaned))
        }
      }
      return
    }
    // Forms and tiling patterns draw with their own resources: prune those to
    // what their content names. The content is fixed, so this is safe to do
    // in place even when several pages share the object.
    const own = dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
    if (own) dict.set(PDFName.of('Resources'), this.prunedCopy(own, decodeStream(object)))
  }
}

const isForm = (stream: PDFStream) =>
  stream.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Form'

const isImage = (dict: PDFDict) =>
  dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Image'

/** DCTDecode as the only filter: the stream is a JPEG file. */
const isPlainJpeg = (dict: PDFDict) => {
  const filter = dict.get(PDFName.of('Filter'))
  const only = filter instanceof PDFArray && filter.size() === 1 ? filter.get(0) : filter
  return only instanceof PDFName && only.decodeText() === 'DCTDecode'
}
