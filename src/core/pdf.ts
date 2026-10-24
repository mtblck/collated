import {
  PDFDocument,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  grayscale,
  PDFName,
  PDFString,
  type PDFFont,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from '@cantoo/pdf-lib'
import { layoutSheet, partLayout, snapPart, visiblePart, type Layout, type Part } from './geometry'
import { compressionFor, targetPixels, type Compression } from './compression'
import { contentSize, pictureKey, picturesOf } from './model'
import type { Asset, Filter, Page, Settings } from './model'
import { FULL_IMAGE, apply, homography, type Quad } from './perspective'
import { NeedsDrawing, embedSanitized, reachesHiddenLayer, sanitizedPage } from './pdfSanitize'
import { stripJpegMetadata } from './jpegClean'
import { headerSize } from './imageInfo'
import { placeWord, type OcrWord } from './textLayer'
import { NUMBER_GREY, numberMark } from './pageNumbers'

export interface BuildInput {
  settings: Settings
  /**
   * Overrides the compression implied by `settings.quality`, so a size-limited
   * export can retry at smaller steps.
   */
  compression?: Compression | null
  pages: Page[]
  /** Encrypts the PDF (AES-256) so it opens only with this. Never stored. */
  password?: string
  /** Recognised words per picture (see `pictureKey`), written as an invisible, searchable text layer. */
  text?: Record<string, OcrWord[]>
  /**
   * PDF pages to export as drawn instead of as vectors (ones that hide a
   * layer): asset id → bytes id of a JPEG of the page as the preview shows it.
   */
  rendered?: Record<string, string>
  assets: Record<
    string,
    Pick<Asset, 'id' | 'width' | 'height' | 'format' | 'storedTurns' | 'bytesId' | 'pdfPage'>
  >
}

export interface BuildOptions {
  /** Returns stored bytes by `bytesId` (the same bytes imported). */
  getBytes: (bytesId: string) => Uint8Array | Promise<Uint8Array>
  /**
   * Decodes an image, filters it, resizes it and re-encodes it. Needs a
   * canvas, so the worker provides it; the result is upright (the decode
   * applies EXIF orientation).
   */
  processImage?: (bytes: Uint8Array, job: ImageJob) => Promise<Uint8Array>
  onProgress?: (done: number, total: number) => void
  /** Fixed for reproducible output in tests. */
  now?: Date
}

/** What to do to one image: the canvas side lives in lib/filterCanvas.ts. */
export interface ImageJob {
  filter: Filter
  /** Flatten this quadrilateral (fractions of the upright image) first. */
  corners: Quad | null
  /**
   * Keep only this rectangle of the upright image (no `corners`): the part a
   * page shows when Fill or a scale past 100% hides the rest. With corners,
   * the part is folded into them instead.
   */
  part: Part | null
  /** Output pixels: of the part, when there is one. */
  width: number
  height: number
  format: 'jpeg' | 'png'
  /** JPEG quality, 0–1. */
  quality: number
}

/**
 * How an image page is stored. Untouched unless it has a filter or the export
 * compresses: B&W stays lossless PNG (text edges), everything else becomes
 * JPEG at the compression's quality (0.9 when only a filter applies).
 */
export const imageJob = (
  asset: Pick<Asset, 'width' | 'height' | 'format'>,
  page: Pick<Page, 'filter'> & Partial<Pick<Page, 'corners'>>,
  drawnWidthPt: number,
  compression: Compression | null,
  part: Part | null = null,
): ImageJob | null => {
  const { filter } = page
  let corners = page.corners ?? null
  if (asset.format === 'pdf' || (filter === 'original' && !compression && !corners && !part)) {
    return null
  }
  const full = targetPixels(contentSize(asset, page), drawnWidthPt, compression)
  const share = part ? { x: part.x1 - part.x0, y: part.y1 - part.y0 } : { x: 1, y: 1 }
  if (part && corners) {
    // A rectangle of the flattened page is a quadrilateral of the photo.
    const h = homography(FULL_IMAGE, corners)
    const at = (x: number, y: number) => apply(h, { x, y })
    corners = [
      at(part.x0, part.y0),
      at(part.x1, part.y0),
      at(part.x1, part.y1),
      at(part.x0, part.y1),
    ]
  }
  return {
    filter,
    corners,
    part: corners ? null : part,
    width: Math.max(1, Math.round(full.width * share.x)),
    height: Math.max(1, Math.round(full.height * share.y)),
    // B&W stays lossless; so does a PNG that is only cropped.
    format:
      filter === 'bw' || (filter === 'original' && !compression && asset.format === 'png')
        ? 'png'
        : 'jpeg',
    // A crop alone re-encodes at the same quality as other unavoidable re-encodes.
    quality: compression?.quality ?? (filter === 'original' ? 0.92 : 0.9),
  }
}

/**
 * Invisible text (rendering mode 3) over each recognised word: selectable and
 * searchable, never drawn. Each word is squeezed horizontally to span the
 * printed word exactly. Words the standard font can't encode (outside
 * Windows-1252) are skipped rather than mangled.
 */
/** Whether every code point (not UTF-16 unit) of `text` is in the font. */
const encodable = (text: string, supported: Set<number>) => {
  for (const ch of text) if (!supported.has(ch.codePointAt(0) ?? -1)) return false
  return true
}

const drawTextLayer = (page: PDFPage, font: PDFFont, layout: Layout, words: OcrWord[]) => {
  const key = page.node.newFontDictionary(font.name, font.ref)
  const supported = new Set(font.getCharacterSet())
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  )
  const box = layout.content
  for (const word of words) {
    // Ligatures and other compatibility forms ("ﬁ") become plain letters,
    // which the font has and searches match.
    const text = word.text.normalize('NFKC')
    // pdf-lib substitutes "?" for characters the font lacks; skip instead.
    if (!encodable(text, supported)) continue
    const at = placeWord(layout, word)
    // Words the page hides (cropped by Fill or scale, or in the margins)
    // aren't on the page, so they aren't in its text either.
    const midX = at.x + at.width / 2
    const midY = layout.page.height - at.y - at.size / 3
    if (midX < box.x || midX > box.x + box.width || midY < box.y || midY > box.y + box.height) {
      continue
    }
    // A trailing space so copied text and screen readers see separate words;
    // the squeeze below spans the word itself.
    const encoded = font.encodeText(`${text} `)
    const natural = font.widthOfTextAtSize(text, at.size)
    if (natural <= 0) continue
    page.pushOperators(
      setFontAndSize(key, at.size),
      setCharacterSqueeze((at.width / natural) * 100),
      setTextMatrix(1, 0, 0, 1, at.x, at.y),
      showText(encoded),
    )
  }
  page.pushOperators(endText(), popGraphicsState())
}

export const PRODUCER = 'Collated'

/** AES-256 PDF passwords are at most 127 bytes of UTF-8 (ISO 32000-2, 7.6.4.3.3). */
export const PASSWORD_MAX_BYTES = 127

/**
 * The password as PDF readers will compare it. The spec has readers prepare
 * passwords with SASLprep, which (for anything a person types) amounts to
 * NFKC; without it "café" typed on a Mac (e + combining accent) opens nothing
 * typed elsewhere. pdf-lib truncates silently past 127 bytes, so refuse that.
 */
export const pdfPassword = (password: string) => {
  const prepared = password.normalize('NFKC')
  if (new TextEncoder().encode(prepared).length > PASSWORD_MAX_BYTES) {
    throw new Error(
      'That password is too long for a PDF: use at most 127 bytes (about 60–120 characters).',
    )
  }
  return prepared
}

/**
 * Where to put the stored content's bottom-left corner, and its size and
 * counter-clockwise rotation, in PDF space (origin bottom-left, y up).
 *
 * The layout describes the upright image in screen space. Stored content may
 * be sideways — a JPEG with EXIF orientation, a PDF page with /Rotate — so its
 * stored size is the upright size swapped and its rotation gains `storedTurns`.
 * pdf-lib's drawImage rotates counter-clockwise about (x, y); screen-space
 * clockwise becomes PDF counter-clockwise once y is flipped, hence the minus.
 */
export const placement = (layout: Layout, storedTurns: number) => {
  const { cx, cy, width, height, rotation } = layout.image
  const swap = storedTurns % 2 === 1
  const w = swap ? height : width
  const h = swap ? width : height
  const ccw = -(rotation + storedTurns * 90)
  const r = (ccw * Math.PI) / 180
  const centreY = layout.page.height - cy
  return {
    x: cx - ((w / 2) * Math.cos(r) - (h / 2) * Math.sin(r)),
    y: centreY - ((w / 2) * Math.sin(r) + (h / 2) * Math.cos(r)),
    width: w,
    height: h,
    rotate: ccw,
  }
}

/**
 * The part of a source PDF page that shows, as pdf.js renders it: the crop box
 * clipped to the media box. Embedding this box (rather than pdf-lib's default,
 * the whole media box) keeps the export identical to the thumbnail.
 */
export const visibleBox = (page: PDFPage) => {
  const media = page.getMediaBox()
  const crop = page.getCropBox()
  const left = Math.max(media.x, crop.x)
  const bottom = Math.max(media.y, crop.y)
  const right = Math.min(media.x + media.width, crop.x + crop.width)
  const top = Math.min(media.y + media.height, crop.y + crop.height)
  return right > left && top > bottom
    ? { left, bottom, right, top }
    : { left: media.x, bottom: media.y, right: media.x + media.width, top: media.y + media.height }
}

/** A page's /Rotate as clockwise quarter turns (PDF rotation is clockwise). */
export const pageTurns = (page: PDFPage): 0 | 1 | 2 | 3 =>
  (((Math.round(page.getRotation().angle / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3

export const buildPdf = async (input: BuildInput, options: BuildOptions): Promise<Uint8Array> => {
  const { settings, pages, assets } = input
  const compression =
    input.compression === undefined ? compressionFor(settings.quality) : input.compression
  const now = options.now ?? new Date()
  const doc = await PDFDocument.create()
  // Only what the user chose to say: no default title, no tool URL, and the
  // date without the time of day.
  const title = settings.title.trim()
  if (title) doc.setTitle(title, { showInWindowTitleBar: true })
  doc.setCreator(PRODUCER)
  doc.setProducer(PRODUCER)
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  doc.setCreationDate(day)
  doc.setModificationDate(day)
  // Screen readers pick a voice by the document's language. OCR reads English.
  doc.catalog.set(PDFName.of('Lang'), PDFString.of('en'))

  // A duplicated page shares its content: embed each asset once, and parse
  // each source PDF once however many of its pages are used.
  type Embedded = ({ kind: 'image'; image: PDFImage } | { kind: 'page'; page: PDFEmbeddedPage }) & {
    turns: number
    /** Holds only the visible part of the image (see `visiblePart`). */
    cropped: boolean
  }
  const embedded = new Map<string, Embedded>()
  let font: PDFFont | undefined
  let textFont: PDFFont | undefined
  const sources = new Map<string, Promise<PDFDocument>>()
  const source = (bytesId: string) => {
    let loaded = sources.get(bytesId)
    if (!loaded) {
      // An empty password opens the common "owner password only" PDFs, which
      // restrict editing but anyone may view.
      loaded = Promise.resolve(options.getBytes(bytesId)).then((bytes) =>
        PDFDocument.load(bytes, { password: '', updateMetadata: false }),
      )
      sources.set(bytesId, loaded)
    }
    return loaded
  }
  /**
   * What a page embeds, and the turns its stored content still needs. A
   * re-encoded image was decoded upright, so it needs none. If compressing
   * without a filter made an image bigger, the original is kept instead.
   */
  const embed = async (asset: BuildInput['assets'][string], job: ImageJob | null) => {
    const key = job
      ? `${asset.id}:${job.filter}:${job.width}x${job.height}:${job.format}:${job.quality}:${JSON.stringify(job.corners)}:${JSON.stringify(job.part)}`
      : asset.id
    const cached = embedded.get(key)
    if (cached) return cached
    let content: Embedded
    if (asset.format === 'pdf') {
      const src = await source(asset.bytesId)
      const srcPage = sanitizedPage(src, src.getPage(asset.pdfPage ?? 0))
      // Fail closed: a page that could hide something is never copied.
      if (reachesHiddenLayer(src, srcPage)) throw new NeedsDrawing([asset.id])
      content = {
        kind: 'page',
        page: await embedSanitized(doc, src, srcPage, visibleBox(srcPage)),
        turns: asset.storedTurns,
        cropped: false,
      }
    } else {
      const original = await options.getBytes(asset.bytesId)
      let bytes = original
      let format: 'jpeg' | 'png' = asset.format
      let turns = asset.storedTurns
      let cropped = false
      if (job) {
        if (!options.processImage) throw new Error('This build can’t re-encode images.')
        const out = await options.processImage(original, job)
        // Filters and crops must apply; plain recompression only if it helps.
        const must = job.filter !== 'original' || job.corners !== null || job.part !== null
        if (must || out.byteLength < original.byteLength) {
          bytes = out
          format = job.format
          turns = 0
          cropped = job.part !== null
        }
      }
      // Camera, time and GPS stay out of the file; the picture is untouched.
      const image =
        format === 'jpeg' ? await doc.embedJpg(stripJpegMetadata(bytes)) : await doc.embedPng(bytes)
      content = { kind: 'image', image, turns, cropped }
    }
    embedded.set(key, content)
    return content
  }

  // PDF pages drawn as the preview shows them are JPEGs from here on: upright,
  // compressed and cropped to what shows like any photo. Layout still goes by
  // the page's own size.
  const drawings = new Map<string, BuildInput['assets'][string]>()
  for (const [assetId, bytesId] of Object.entries(input.rendered ?? {})) {
    const original = assets[assetId]
    const size = headerSize(await options.getBytes(bytesId))
    if (!original || !size) throw new Error('A drawn PDF page could not be read.')
    drawings.set(assetId, { ...original, ...size, format: 'jpeg', storedTurns: 0, bytesId })
  }

  // Every PDF page that must be drawn, found before anything is copied, so
  // the export can draw them all and build again in one round.
  const toDraw = Object.values(assets).filter((asset) => {
    if (asset.format !== 'pdf' || drawings.has(asset.id)) return false
    return pages.some((p) => picturesOf(p).some((slot) => slot.assetId === asset.id))
  })
  const mustDraw: string[] = []
  for (const asset of toDraw) {
    const src = await source(asset.bytesId)
    const srcPage = sanitizedPage(src, src.getPage(asset.pdfPage ?? 0))
    if (reachesHiddenLayer(src, srcPage)) mustDraw.push(asset.id)
  }
  if (mustDraw.length) throw new NeedsDrawing(mustDraw)

  for (const [index, page] of pages.entries()) {
    const pictures = picturesOf(page)
    if (pictures.some((slot) => !assets[slot.assetId])) {
      throw new Error(`Page ${index + 1} refers to missing content.`)
    }
    const sheet = layoutSheet(settings, assets, page)
    const pdfPage = doc.addPage([sheet.page.width, sheet.page.height])
    for (const [i, slot] of pictures.entries()) {
      const asset = assets[slot.assetId]
      const layout = sheet.pictures[i]
      if (!asset || !layout) continue
      const drawn = drawings.get(asset.id)
      const stored = drawn ?? asset
      // A drawn page is shown as it is: PDF pages take no crop and no filter.
      const look = drawn ? { ...slot, corners: null, filter: 'original' as const } : slot
      const visible = stored.format === 'pdf' ? null : visiblePart(layout)
      // Whole source pixels, unless corners resample anyway.
      const source = contentSize(stored, look)
      const part =
        visible && !look.corners ? snapPart(visible, source.width, source.height) : visible
      const content = await embed(
        stored,
        imageJob(stored, look, layout.image.width, compression, part),
      )
      const box = layout.content
      const at = placement(
        content.cropped && part ? partLayout(layout, part) : layout,
        content.turns,
      )

      // Clip to the printable area (on a combined page, the picture's own
      // cell) so a scaled-up or filled image never prints into the margins —
      // the preview clips the same way.
      pdfPage.pushOperators(
        pushGraphicsState(),
        rectangle(box.x, layout.page.height - box.y - box.height, box.width, box.height),
        clip(),
        endPath(),
      )
      const draw = { ...at, rotate: degrees(at.rotate) }
      if (content.kind === 'page') pdfPage.drawPage(content.page, draw)
      else pdfPage.drawImage(content.image, draw)
      pdfPage.pushOperators(popGraphicsState())

      const words = input.text?.[pictureKey(page, i)]
      if (words?.length) {
        textFont ??= await doc.embedFont(StandardFonts.Helvetica)
        drawTextLayer(pdfPage, textFont, layout, words)
      }
    }

    const mark = numberMark(settings.pageNumbers, index, sheet.page, sheet.content.x)
    if (mark) {
      font ??= await doc.embedFont(StandardFonts.Helvetica)
      const width = font.widthOfTextAtSize(mark.text, mark.size)
      pdfPage.drawText(mark.text, {
        x: mark.align === 'center' ? mark.x - width / 2 : mark.x - width,
        y: sheet.page.height - mark.baseline,
        size: mark.size,
        font,
        color: grayscale(NUMBER_GREY),
      })
    }
    options.onProgress?.(index + 1, pages.length)
  }

  if (input.password) {
    const password = pdfPassword(input.password)
    // Opening needs the password; once open, nothing is restricted (it's a
    // lock on the file, not DRM). The owner password is random and discarded.
    const owner = new Uint8Array(24)
    crypto.getRandomValues(owner)
    doc.encrypt({
      userPassword: password,
      ownerPassword: Array.from(owner, (b) => b.toString(16).padStart(2, '0')).join(''),
      permissions: {
        printing: 'highResolution',
        modifying: true,
        copying: true,
        annotating: true,
        fillingForms: true,
        contentAccessibility: true,
        documentAssembly: true,
      },
    })
  }

  return doc.save({ useObjectStreams: true })
}
