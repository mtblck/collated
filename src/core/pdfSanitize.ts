import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFPage,
  PDFPageLeaf,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFObjectCopier,
  decodePDFRawStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from '@cantoo/pdf-lib'
import { stripJpegMetadata } from './jpegClean'
import { cleanContent, concat } from './pdfContent'

/**
 * A copy of a source page that carries only what draws it: its content and
 * the resources that content names. Embedding a page as-is copies its whole
 * dictionary — comments, form fields, actions, thumbnails, metadata — and its
 * whole resource dictionary, which many scanners share across every page, so
 * one kept page would carry all the others' images. Image metadata (XMP, and
 * EXIF inside JPEG data) is removed too, and so is anything in a layer the
 * source hides.
 *
 * What the content itself draws outside the visible box is still there (it's
 * one stream); the export clips it away, like any viewer would.
 */
export const sanitizedPage = (doc: PDFDocument, page: PDFPage): PDFPage => {
  const context = doc.context
  const source = page.node
  const resources = source.Resources()
  const contents = source.get(PDFName.of('Contents'))
  const scrub = scrubberFor(doc)
  const raw = contents ? decodeContents(context, contents) : new Uint8Array()
  const content = cleanContent(raw, scrub.hiddenIn(resources))
  const leaf = PDFPageLeaf.fromMapWithContext(new Map(), context, false)
  leaf.set(PDFName.of('Type'), PDFName.of('Page'))
  leaf.set(PDFName.of('MediaBox'), source.MediaBox())
  const crop = source.CropBox()
  if (crop) leaf.set(PDFName.of('CropBox'), crop)
  const rotate = source.Rotate()
  if (rotate) leaf.set(PDFName.of('Rotate'), rotate)
  scrub.page = resources
  const pruned = resources ? scrub.prunedCopy(resources, content.bytes) : context.obj({})
  leaf.set(PDFName.of('Resources'), pruned)

  // What the page shows on top of its content: filled form fields, stamps,
  // signatures, highlights, note icons (as pdf.js draws them for the
  // preview). Each annotation's own appearance is drawn into the page; the
  // annotations themselves (comment text, form data, actions) stay behind.
  const shown = annotationAppearances(doc, source, scrub.visible)
  let overlay = ''
  if (shown.length) {
    let xobjects = pruned.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) {
      xobjects = context.obj({})
      pruned.set(PDFName.of('XObject'), xobjects)
    }
    shown.forEach(({ ref, matrix }, i) => {
      let name = `CollatedAnnot${String(i)}`
      while (xobjects.has(PDFName.of(name))) name += '_'
      xobjects.set(PDFName.of(name), ref)
      overlay += `q ${matrix.map(fmt).join(' ')} cm /${name} Do Q\n`
    })
  }
  // One new content stream: the page's own content, closed off so the
  // overlay starts from the page's initial state (sections and saved states
  // it leaves open are closed), then the overlay.
  const close = 'EMC\n'.repeat(content.openSections) + 'Q\n'.repeat(content.openStates)
  const stream = concat([encode('q\n'), content.bytes, encode(`\n${close}Q\n${overlay}`)])
  leaf.set(PDFName.of('Contents'), context.register(context.flateStream(stream)))
  scrub.visit(pruned)
  return PDFPage.of(leaf, context.register(leaf), doc)
}

const fmt = (n: number) => String(Math.round(n * 1e6) / 1e6)
const encode = (text: string) => new TextEncoder().encode(text)

/** `dict[key]`, resolved, if it is a `type`; undefined if missing or anything else. */
const get = <T extends PDFObject>(
  context: PDFContext,
  dict: PDFDict,
  key: string,
  type: { prototype: T },
): T | undefined => {
  const value = dict.get(PDFName.of(key))
  const resolved = value === undefined ? undefined : context.lookup(value)
  // pdf-lib's constructors are private, so `type` isn't typed as one.
  return resolved instanceof (type as unknown as abstract new () => unknown)
    ? (resolved as T)
    : undefined
}

const numbers = (array: PDFArray | undefined) =>
  array?.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN)) ?? []

/** Annotation flags (PDF 32000-1, 12.5.3) that keep it off screen. */
const HIDDEN = 1 << 1
const NO_VIEW = 1 << 5

/**
 * The normal appearance of each visible annotation, with the matrix that
 * places it on its rectangle (PDF 32000-1, 12.5.5, "Algorithm: appearance
 * streams"): the form's bounding box, through its own matrix, mapped onto
 * the annotation's rectangle. Anything malformed is left out, not an error.
 */
const annotationAppearances = (
  doc: PDFDocument,
  page: PDFPageLeaf,
  visible: (oc: PDFObject | undefined) => boolean,
) => {
  const { context } = doc
  const out: { ref: PDFRef; matrix: number[] }[] = []
  const annots = get(context, page, 'Annots', PDFArray)
  for (const entry of annots?.asArray() ?? []) {
    try {
      const shown = appearanceOf(doc, page, context.lookup(entry), visible)
      if (shown) out.push(shown)
    } catch {
      // A damaged annotation draws nothing, as in most viewers.
    }
  }
  return out
}

const appearanceOf = (
  doc: PDFDocument,
  page: PDFPageLeaf,
  annot: PDFObject | undefined,
  visible: (oc: PDFObject | undefined) => boolean,
) => {
  const { context } = doc
  if (!(annot instanceof PDFDict) || annot instanceof PDFStream) return null
  const subtype = get(context, annot, 'Subtype', PDFName)?.decodeText()
  // Pop-ups are the open comment text; links draw nothing of their own.
  if (subtype === 'Popup' || subtype === 'Link') return null
  const flags = get(context, annot, 'F', PDFNumber)?.asNumber() ?? 0
  if (flags & (HIDDEN | NO_VIEW)) return null
  // In a layer the source hides: not shown, so not drawn.
  if (!visible(annot.get(PDFName.of('OC')))) return null
  const ap = get(context, annot, 'AP', PDFDict)
  let normal = ap?.get(PDFName.of('N'))
  // Checkboxes and the like: a dictionary of states, picked by /AS.
  const states = normal ? context.lookup(normal) : undefined
  if (states instanceof PDFDict && !(states instanceof PDFStream)) {
    const state = get(context, annot, 'AS', PDFName)
    normal = state ? states.get(state) : undefined
  }
  if (!(normal instanceof PDFRef)) return null
  const form = context.lookup(normal)
  if (!(form instanceof PDFStream) || !isForm(form)) return null
  const rect = numbers(get(context, annot, 'Rect', PDFArray))
  const bbox = numbers(get(context, form.dict, 'BBox', PDFArray))
  const m = numbers(get(context, form.dict, 'Matrix', PDFArray))
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = m.length === 6 ? m : []
  if (rect.length !== 4 || bbox.length !== 4) return null
  const [bx0 = 0, by0 = 0, bx1 = 0, by1 = 0] = bbox
  const corners = [
    [bx0, by0],
    [bx1, by0],
    [bx1, by1],
    [bx0, by1],
  ].map(([x = 0, y = 0]) => [a * x + c * y + e, b * x + d * y + f])
  const xs = corners.map(([x = 0]) => x)
  const ys = corners.map(([, y = 0]) => y)
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ]
  const [rx0 = 0, ry0 = 0, rx1 = 0, ry1 = 0] = rect
  const left = Math.min(rx0, rx1)
  const bottom = Math.min(ry0, ry1)
  const width = Math.abs(rx1 - rx0)
  const height = Math.abs(ry1 - ry0)
  if (!(maxX - minX > 0 && maxY - minY > 0 && width > 0 && height > 0)) return null
  const sx = width / (maxX - minX)
  const sy = height / (maxY - minY)
  const matrix = [sx, 0, 0, sy, left - minX * sx, bottom - minY * sy]
  if (!matrix.every((n) => Number.isFinite(n) && Math.abs(n) < 1e7)) return null
  // An appearance without resources of its own: viewers use the form's
  // default resources (fonts for field text) or the page's.
  if (!form.dict.has(PDFName.of('Resources'))) {
    const dr =
      subtype === 'Widget'
        ? get(context, doc.catalog, 'AcroForm', PDFDict)?.get(PDFName.of('DR'))
        : undefined
    const fallback = dr ?? page.get(PDFName.of('Resources'))
    if (fallback) form.dict.set(PDFName.of('Resources'), fallback)
  }
  return { ref: normal, matrix }
}

/** One copier per source and output, so a font or layer used by several pages is copied once. */
const copiers = new WeakMap<PDFDocument, WeakMap<PDFDocument, PDFObjectCopier>>()
const copierFor = (src: PDFDocument, out: PDFDocument) => {
  let bySource = copiers.get(out)
  if (!bySource) {
    bySource = new WeakMap()
    copiers.set(out, bySource)
  }
  let copier = bySource.get(src)
  if (!copier) {
    copier = PDFObjectCopier.for(src.context, out.context)
    bySource.set(src, copier)
  }
  return copier
}

/**
 * Embeds a sanitized page into `out`, carrying its optional content (layers)
 * with the source's default visibility. What hidden layers drew is already
 * gone (see `sanitizedPage`); the layers that remain keep their names and
 * state, so a viewer's layer panel still works.
 */
export const embedSanitized = async (
  out: PDFDocument,
  src: PDFDocument,
  page: PDFPage,
  box: { left: number; bottom: number; right: number; top: number },
) => {
  const copied = copierFor(src, out).copy(page.node)
  // Pair each source object with its copy, to find the layers it uses.
  const layers: { from: PDFRef; to: PDFRef }[] = []
  const seen = new Set<PDFRef>()
  const walk = (a: PDFObject | undefined, b: PDFObject | undefined) => {
    if (!a || !b) return
    if (a instanceof PDFRef && b instanceof PDFRef) {
      if (seen.has(a)) return
      seen.add(a)
      const target = src.context.lookup(a)
      if (target instanceof PDFDict && !(target instanceof PDFStream)) {
        if (target.lookupMaybe(PDFName.of('Type'), PDFName)?.decodeText() === 'OCG') {
          layers.push({ from: a, to: b })
        }
      }
      walk(target, out.context.lookup(b))
      return
    }
    if (a instanceof PDFArray && b instanceof PDFArray) {
      a.asArray().forEach((item, i) => {
        walk(item, b.get(i))
      })
      return
    }
    const da = a instanceof PDFStream ? a.dict : a instanceof PDFDict ? a : undefined
    const db = b instanceof PDFStream ? b.dict : b instanceof PDFDict ? b : undefined
    if (!da || !db) return
    for (const [key, value] of da.entries()) walk(value, db.get(key))
  }
  walk(page.node, copied)
  if (layers.length) addLayers(out, src, layers)
  const leaf = copied
  const ref = out.context.register(leaf)
  return out.embedPage(PDFPage.of(leaf, ref, out), box)
}

/** The source's default layer configuration (PDF 32000-1, 8.11.4.3). */
const layerConfig = (src: PDFDocument) => {
  const { context } = src
  const props = get(context, src.catalog, 'OCProperties', PDFDict)
  const config = props ? get(context, props, 'D', PDFDict) : undefined
  const refsIn = (key: string) =>
    new Set(config ? (get(context, config, key, PDFArray)?.asArray() ?? []) : [])
  const on = refsIn('ON')
  const off = refsIn('OFF')
  const baseOff = config
    ? get(context, config, 'BaseState', PDFName)?.decodeText() === 'OFF'
    : false
  return (layer: PDFObject) => !off.has(layer) && (on.has(layer) || !baseOff)
}

/**
 * Whether content marked with optional-content object `oc` shows by
 * default: a layer (OCG) by the configuration, a membership dictionary
 * (OCMD) by its visibility expression or policy. Missing or unreadable
 * entries show, as the spec says.
 */
const visibilityOf = (src: PDFDocument) => {
  const { context } = src
  const isOn = layerConfig(src)
  const visible = (oc: PDFObject | undefined, depth = 0): boolean => {
    if (!oc || depth > 8) return true
    const value = context.lookup(oc)
    if (!(value instanceof PDFDict) || value instanceof PDFStream) return true
    const type = get(context, value, 'Type', PDFName)?.decodeText()
    if (type === 'OCG') return oc instanceof PDFRef ? isOn(oc) : true
    if (type !== 'OCMD') return true
    const expression = get(context, value, 'VE', PDFArray)
    if (expression) return evaluate(expression, depth)
    const listed = value.get(PDFName.of('OCGs'))
    const resolved = listed ? context.lookup(listed) : undefined
    const groups =
      resolved instanceof PDFArray ? resolved.asArray() : listed instanceof PDFRef ? [listed] : []
    const states = groups
      .filter((g) => context.lookup(g) instanceof PDFDict)
      .map((g) => visible(g, depth + 1))
    if (!states.length) return true
    switch (get(context, value, 'P', PDFName)?.decodeText()) {
      case 'AllOn':
        return states.every(Boolean)
      case 'AnyOff':
        return states.some((on) => !on)
      case 'AllOff':
        return states.every((on) => !on)
      default:
        return states.some(Boolean)
    }
  }
  const evaluate = (expression: PDFArray, depth: number): boolean => {
    if (depth > 8) return true
    const [op, ...args] = expression.asArray()
    const values = args.map((arg) => {
      const resolved = context.lookup(arg)
      return resolved instanceof PDFArray ? evaluate(resolved, depth + 1) : visible(arg, depth + 1)
    })
    const name = op instanceof PDFName ? op.decodeText() : ''
    if (name === 'Not') return !(values[0] ?? false)
    if (name === 'And') return values.every(Boolean)
    if (name === 'Or') return values.some(Boolean)
    return true
  }
  return (oc: PDFObject | undefined) => visible(oc)
}

/** Lists the layers in `out`'s catalog, hidden where the source hides them. */
const addLayers = (out: PDFDocument, src: PDFDocument, layers: { from: PDFRef; to: PDFRef }[]) => {
  const isOn = layerConfig(src)
  let props = out.catalog.lookupMaybe(PDFName.of('OCProperties'), PDFDict)
  if (!props) {
    props = out.context.obj({ OCGs: [], D: { OFF: [] } })
    out.catalog.set(PDFName.of('OCProperties'), props)
  }
  const ocgs = props.lookup(PDFName.of('OCGs'), PDFArray)
  const hidden = props.lookup(PDFName.of('D'), PDFDict).lookup(PDFName.of('OFF'), PDFArray)
  for (const { from, to } of layers) {
    if (ocgs.asArray().includes(to)) continue
    ocgs.push(to)
    if (!isOn(from)) hidden.push(to)
  }
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

/** One scrubber per source document: what it has cleaned stays cleaned. */
const scrubbers = new WeakMap<PDFDocument, Scrubber>()
const scrubberFor = (doc: PDFDocument) => {
  let scrubber = scrubbers.get(doc)
  if (!scrubber) {
    scrubber = new Scrubber(doc.context, visibilityOf(doc))
    scrubbers.set(doc, scrubber)
  }
  return scrubber
}

/**
 * Walks everything a kept page reaches. Wherever a resource dictionary
 * appears (forms, tiling patterns, Type 3 fonts, soft-mask groups, anything)
 * it is replaced with a copy holding only what that object's own content
 * names, so a shared dictionary can't carry the rest of the file along.
 * Content streams lose what hidden layers draw and inline JPEGs' metadata;
 * images lose theirs. Only content and images are decoded: fonts, colour
 * profiles and the like are copied as they are.
 */
class Scrubber {
  private readonly seen = new Set<PDFRef>()
  private readonly cleaned = new Map<PDFStream, { bytes: Uint8Array; changed: boolean }>()
  /** The resources of the page being cleaned: forms without their own use them. */
  page: PDFDict | undefined

  constructor(
    private readonly context: PDFContext,
    readonly visible: (oc: PDFObject | undefined) => boolean,
  ) {}

  /** Whether `/OC /name BDC` content is hidden, by the Properties in `resources`. */
  hiddenIn(resources: PDFDict | undefined) {
    const properties = resources ? get(this.context, resources, 'Properties', PDFDict) : undefined
    return (name: string) => {
      const entry = properties?.get(PDFName.of(name))
      return entry !== undefined && !this.visible(entry)
    }
  }

  /** A content stream's bytes as kept (see `cleanContent`), once per stream. */
  private contentBytes(stream: PDFStream, resources: PDFDict | undefined) {
    let done = this.cleaned.get(stream)
    if (!done) {
      const decoded = decodeStream(stream)
      const { bytes } = cleanContent(decoded, this.hiddenIn(resources))
      done = { bytes, changed: bytes !== decoded }
      this.cleaned.set(stream, done)
    }
    return done
  }

  private resourcesOf(dict: PDFDict) {
    return get(this.context, dict, 'Resources', PDFDict) ?? this.page
  }

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
    const pageXObjects = get(this.context, resources, 'XObject', PDFDict)
    const visited = new Set<PDFObject>()
    // Forms reached from `xobjects` by the names in `names`.
    const walk = (xobjects: PDFDict | undefined, names: Set<string>) => {
      if (!xobjects) return
      for (const [name, ref] of xobjects.entries()) {
        if (!names.has(name.decodeText()) || visited.has(ref)) continue
        visited.add(ref)
        const form = this.context.lookup(ref)
        if (!(form instanceof PDFStream) || !isForm(form)) continue
        const own = get(this.context, form.dict, 'Resources', PDFDict)
        const inner = namesIn(this.contentBytes(form, own ?? resources).bytes)
        if (own) {
          walk(get(this.context, own, 'XObject', PDFDict), inner)
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
    let stream = value instanceof PDFStream ? value : undefined
    let dict = stream ? stream.dict : value instanceof PDFDict ? value : undefined
    if (!dict) return
    for (const key of DROPPED_KEYS) dict.delete(PDFName.of(key))

    // An image or form in a hidden layer: drawn as nothing.
    if (
      ref &&
      stream &&
      (isImage(dict) || isForm(stream)) &&
      !this.visible(dict.get(PDFName.of('OC')))
    ) {
      this.context.assign(ref, emptyForm(this.context))
      return
    }

    if (ref && stream instanceof PDFRawStream && isImage(dict)) {
      const replaced = this.cleanImage(ref, stream)
      if (replaced) {
        stream = replaced
        dict = replaced.dict
      }
    }

    // Forms and tiling patterns are content: hidden layers and inline JPEGs
    // come out of them like out of the page.
    if (ref && stream && (isForm(stream) || isTilingPattern(dict))) {
      const { bytes, changed } = this.contentBytes(stream, this.resourcesOf(dict))
      if (changed) stream = this.replaceContent(ref, stream, bytes)
      dict = stream.dict
    }

    // Type 3 glyphs are content too, with the font's resources.
    const procs = isType3(this.context, dict)
      ? get(this.context, dict, 'CharProcs', PDFDict)
      : undefined
    const glyphs: Uint8Array[] = []
    for (const [, proc] of procs?.entries() ?? []) {
      const glyph = this.context.lookup(proc)
      if (!(glyph instanceof PDFStream) || !(proc instanceof PDFRef)) continue
      const { bytes, changed } = this.contentBytes(glyph, this.resourcesOf(dict))
      if (changed) this.replaceContent(proc, glyph, bytes)
      glyphs.push(bytes, new Uint8Array([0x0a]))
    }

    // Prune this object's own resources to what its own content names. The
    // content is fixed, so this is safe in place even when pages share it.
    const own = get(this.context, dict, 'Resources', PDFDict)
    if (own) {
      const content = stream
        ? this.contentBytes(stream, own).bytes
        : procs
          ? concat(glyphs)
          : new Uint8Array()
      // Only things that draw use resources; anything else keeps none.
      dict.set(PDFName.of('Resources'), this.prunedCopy(own, content))
    }

    for (const [, entry] of dict.entries()) this.visit(entry)
  }

  /** Swaps a content stream for one holding `bytes`, keeping its other entries. */
  private replaceContent(ref: PDFRef, stream: PDFStream, bytes: Uint8Array) {
    const fresh = this.context.flateStream(bytes)
    for (const [key, value] of stream.dict.entries()) {
      if (!['Filter', 'DecodeParms', 'Length'].includes(key.decodeText()))
        fresh.dict.set(key, value)
    }
    this.context.assign(ref, fresh)
    this.cleaned.set(fresh, { bytes, changed: false })
    return fresh
  }

  /**
   * A JPEG image without its metadata. One wrapped in other filters (Flate
   * around DCT, say) is unwrapped and stored as a plain JPEG; one that can't
   * be read is drawn as nothing rather than carried with its metadata.
   */
  private cleanImage(ref: PDFRef, stream: PDFRawStream): PDFStream | undefined {
    const { dict } = stream
    const filter = dict.get(PDFName.of('Filter'))
    const resolved = filter ? this.context.lookup(filter) : undefined
    const filters = resolved instanceof PDFArray ? resolved.asArray() : resolved ? [resolved] : []
    const names = filters.map((f) => (f instanceof PDFName ? f.decodeText() : ''))
    if (!names.includes('DCTDecode')) return undefined
    if (names.length === 1) {
      const cleaned = stripJpegMetadata(stream.contents)
      if (cleaned === stream.contents) return undefined
      dict.set(PDFName.of('Length'), PDFNumber.of(cleaned.length))
      const fresh = PDFRawStream.of(dict, cleaned)
      this.context.assign(ref, fresh)
      return fresh
    }
    try {
      if (names.at(-1) !== 'DCTDecode') throw new Error('DCT is not the innermost filter')
      const parms = dict.get(PDFName.of('DecodeParms'))
      const parmsList = parms ? this.context.lookup(parms) : undefined
      const outer = dict.clone(this.context)
      outer.set(
        PDFName.of('Filter'),
        this.context.obj(names.slice(0, -1).map((n) => PDFName.of(n))),
      )
      const innerParms =
        parmsList instanceof PDFArray ? parmsList.get(parmsList.size() - 1) : undefined
      if (parmsList instanceof PDFArray) {
        outer.set(PDFName.of('DecodeParms'), this.context.obj(parmsList.asArray().slice(0, -1)))
      } else outer.delete(PDFName.of('DecodeParms'))
      const jpeg = decodePDFRawStream(PDFRawStream.of(outer, stream.contents)).decode()
      if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG')
      const cleaned = stripJpegMetadata(jpeg)
      const plain = dict.clone(this.context)
      plain.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
      if (innerParms && innerParms !== PDFNull) plain.set(PDFName.of('DecodeParms'), innerParms)
      else plain.delete(PDFName.of('DecodeParms'))
      plain.set(PDFName.of('Length'), PDFNumber.of(cleaned.length))
      const fresh = PDFRawStream.of(plain, cleaned)
      this.context.assign(ref, fresh)
      return fresh
    } catch {
      this.context.assign(ref, emptyForm(this.context))
      return undefined
    }
  }
}

const emptyForm = (context: PDFContext) =>
  context.stream(new Uint8Array(), { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 0, 0] })

const isForm = (stream: PDFStream) =>
  stream.dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Form'

const isImage = (dict: PDFDict) =>
  dict.get(PDFName.of('Subtype')) instanceof PDFName &&
  dict.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() === 'Image'

const isTilingPattern = (dict: PDFDict) => {
  const type = dict.get(PDFName.of('PatternType'))
  return type instanceof PDFNumber && type.asNumber() === 1
}

const isType3 = (context: PDFContext, dict: PDFDict) =>
  get(context, dict, 'Subtype', PDFName)?.decodeText() === 'Type3'
