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
  const pruned = resources ? scrub.prunedCopy(resources, content) : context.obj({})
  leaf.set(PDFName.of('Resources'), pruned)
  scrub.visit(pruned)
  if (contents) scrub.visit(contents)
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
  for (const match of text.matchAll(/\/([^\s\0/[\]()<>{}%]*)/g)) {
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

/**
 * Keys a drawn resource never needs that can point at other content: metadata,
 * print alternates, links back into the document's page or structure tree
 * (which would drag every page along), and actions.
 */
const DROPPED_KEYS = [
  'Metadata',
  'PieceInfo',
  'Alternates',
  'OPI',
  'Parent',
  'P',
  'StructParent',
  'StructParents',
  'AA',
  'Thumb',
] as const

/**
 * Walks everything a kept page reaches. Wherever a resource dictionary
 * appears (forms, tiling patterns, Type 3 fonts, soft-mask groups, anything)
 * it is replaced with a copy holding only what that object's own content
 * names, so a shared dictionary can't carry the rest of the file along.
 */
class Scrubber {
  private readonly seen = new Set<PDFRef>()

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
        // ProcSet is a list of names; anything unknown is dropped.
        if (kind === 'ProcSet') out.set(key, value)
        continue
      }
      const dict = this.context.lookupMaybe(value, PDFDict)
      if (!dict) continue
      const kept = this.context.obj({})
      for (const [name, entry] of dict.entries()) {
        if (used.has(name.decodeText())) kept.set(name, entry)
      }
      if (kept.keys().length) out.set(key, kept)
    }
    return out
  }

  /**
   * Adds names used by forms that have no resources of their own: viewers
   * look those up in the page's resources, however deeply the form is nested
   * inside other forms. Over-including is safe; missing one blanks content.
   */
  private inheritedNames(resources: PDFDict, used: Set<string>) {
    const pageXObjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    const visited = new Set<PDFObject>()
    // Forms reached from `xobjects` by the names in `names`.
    const walk = (xobjects: PDFDict | undefined, names: Set<string>) => {
      if (!xobjects) return
      for (const [name, ref] of xobjects.entries()) {
        if (!names.has(name.decodeText()) || visited.has(ref)) continue
        visited.add(ref)
        const form = this.context.lookup(ref)
        if (!(form instanceof PDFStream) || !isForm(form)) continue
        const inner = namesIn(decodeStream(form))
        const own = form.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
        if (own) {
          walk(own.lookupMaybe(PDFName.of('XObject'), PDFDict), inner)
        } else {
          const before = used.size
          for (const n of inner) used.add(n)
          // New page-level names may name more forms.
          if (used.size > before) walk(pageXObjects, used)
          walk(pageXObjects, inner)
        }
      }
    }
    walk(pageXObjects, used)
  }

  /** Cleans `object` and everything it reaches. */
  visit(object: PDFObject | undefined): void {
    if (!object) return
    let ref: PDFRef | undefined
    let value: PDFObject | undefined = object
    if (object instanceof PDFRef) {
      if (this.seen.has(object)) return
      this.seen.add(object)
      ref = object
      value = this.context.lookup(object)
    }
    if (value instanceof PDFArray) {
      for (const item of value.asArray()) this.visit(item)
      return
    }
    const stream = value instanceof PDFStream ? value : undefined
    const dict = stream ? stream.dict : value instanceof PDFDict ? value : undefined
    if (!dict) return
    for (const key of DROPPED_KEYS) dict.delete(PDFName.of(key))

    if (ref && stream instanceof PDFRawStream && isImage(dict) && isPlainJpeg(dict)) {
      const cleaned = stripJpegMetadata(stream.contents)
      if (cleaned !== stream.contents) {
        dict.set(PDFName.of('Length'), PDFNumber.of(cleaned.length))
        this.context.assign(ref, PDFRawStream.of(dict, cleaned))
      }
    }

    // Prune this object's own resources to what its own content names. The
    // content is fixed, so this is safe in place even when pages share it.
    const own = dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
    if (own) dict.set(PDFName.of('Resources'), this.prunedCopy(own, this.contentOf(dict, stream)))

    for (const [, entry] of dict.entries()) this.visit(entry)
  }

  /** What draws with a dictionary's resources: its stream, or a Type 3 font's glyphs. */
  private contentOf(dict: PDFDict, stream: PDFStream | undefined): Uint8Array {
    if (stream) return decodeStream(stream)
    const parts: Uint8Array[] = []
    const procs = dict.lookupMaybe(PDFName.of('CharProcs'), PDFDict)
    for (const [, proc] of procs?.entries() ?? []) {
      const glyph = this.context.lookup(proc)
      if (glyph instanceof PDFStream) parts.push(decodeStream(glyph), new Uint8Array([0x0a]))
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let offset = 0
    for (const part of parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
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
