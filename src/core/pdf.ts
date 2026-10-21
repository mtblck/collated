import {
  PDFDocument,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  StandardFonts,
  grayscale,
  type PDFFont,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from '@cantoo/pdf-lib'
import { layoutPage, type Layout } from './geometry'
import { compressionFor, targetPixels, type Compression } from './compression'
import type { Asset, Filter, Page, Settings } from './model'
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
  filter: Filter,
  drawnWidthPt: number,
  compression: Compression | null,
): ImageJob | null => {
  if (asset.format === 'pdf' || (filter === 'original' && !compression)) return null
  const { width, height } = targetPixels(asset, drawnWidthPt, compression)
  return {
    filter,
    width,
    height,
    format: filter === 'bw' ? 'png' : 'jpeg',
    quality: compression?.quality ?? 0.9,
  }
}

export const PRODUCER = 'Collated — mattblack.space/tools/collated'

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
  doc.setTitle(settings.title.trim() || 'Collated scans', { showInWindowTitleBar: true })
  doc.setCreator('Collated')
  doc.setProducer(PRODUCER)
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  // A duplicated page shares its content: embed each asset once, and parse
  // each source PDF once however many of its pages are used.
  type Embedded = ({ kind: 'image'; image: PDFImage } | { kind: 'page'; page: PDFEmbeddedPage }) & {
    turns: number
  }
  const embedded = new Map<string, Embedded>()
  let font: PDFFont | undefined
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
      ? `${asset.id}:${job.filter}:${job.width}x${job.height}:${job.format}:${job.quality}`
      : asset.id
    const cached = embedded.get(key)
    if (cached) return cached
    let content: Embedded
    if (asset.format === 'pdf') {
      const src = await source(asset.bytesId)
      const srcPage = src.getPage(asset.pdfPage ?? 0)
      content = {
        kind: 'page',
        page: await doc.embedPage(srcPage, visibleBox(srcPage)),
        turns: asset.storedTurns,
      }
    } else {
      const original = await options.getBytes(asset.bytesId)
      let bytes = original
      let format: 'jpeg' | 'png' = asset.format
      let turns = asset.storedTurns
      if (job) {
        if (!options.processImage) throw new Error('This build can’t re-encode images.')
        const out = await options.processImage(original, job)
        if (job.filter !== 'original' || out.byteLength < original.byteLength) {
          bytes = out
          format = job.format
          turns = 0
        }
      }
      const image = format === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
      content = { kind: 'image', image, turns }
    }
    embedded.set(key, content)
    return content
  }

  for (const [index, page] of pages.entries()) {
    const asset = assets[page.assetId]
    if (!asset) throw new Error(`Page ${index + 1} refers to missing content.`)
    const layout = layoutPage(settings, asset, page)
    const pdfPage = doc.addPage([layout.page.width, layout.page.height])
    const content = await embed(
      asset,
      imageJob(asset, page.filter, layout.image.width, compression),
    )
    const box = layout.content
    const at = placement(layout, content.turns)

    // Clip to the printable area so a scaled-up or filled image never prints
    // into the margins — the preview clips the same way.
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

    const mark = numberMark(settings.pageNumbers, index, layout.page, layout.content.x)
    if (mark) {
      font ??= await doc.embedFont(StandardFonts.Helvetica)
      const width = font.widthOfTextAtSize(mark.text, mark.size)
      pdfPage.drawText(mark.text, {
        x: mark.align === 'center' ? mark.x - width / 2 : mark.x - width,
        y: layout.page.height - mark.baseline,
        size: mark.size,
        font,
        color: grayscale(NUMBER_GREY),
      })
    }
    options.onProgress?.(index + 1, pages.length)
  }

  if (input.password) {
    // Opening needs the password; once open, nothing is restricted (it's a
    // lock on the file, not DRM). The owner password is random and discarded.
    const owner = new Uint8Array(24)
    crypto.getRandomValues(owner)
    doc.encrypt({
      userPassword: input.password,
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
