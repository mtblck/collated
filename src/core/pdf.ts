import {
  PDFDocument,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage,
} from '@cantoo/pdf-lib'
import { layoutPage, type Layout } from './geometry'
import type { Asset, Filter, Page, Settings } from './model'

export interface BuildInput {
  settings: Settings
  pages: Page[]
  assets: Record<
    string,
    Pick<Asset, 'id' | 'width' | 'height' | 'format' | 'storedTurns' | 'bytesId' | 'pdfPage'>
  >
}

export interface BuildOptions {
  /** Returns stored bytes by `bytesId` (the same bytes imported). */
  getBytes: (bytesId: string) => Uint8Array | Promise<Uint8Array>
  /**
   * Decodes, filters and re-encodes an image for a page with a filter. Needs
   * a canvas, so the worker provides it; the result is upright (stored turns
   * already applied by the decode).
   */
  filterImage?: (
    bytes: Uint8Array,
    filter: Exclude<Filter, 'original'>,
  ) => Promise<{ bytes: Uint8Array; format: 'jpeg' | 'png' }>
  onProgress?: (done: number, total: number) => void
  /** Fixed for reproducible output in tests. */
  now?: Date
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
  const now = options.now ?? new Date()
  const doc = await PDFDocument.create()
  doc.setTitle(settings.title.trim() || 'Collated scans', { showInWindowTitleBar: true })
  doc.setCreator('Collated')
  doc.setProducer(PRODUCER)
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  // A duplicated page shares its content: embed each asset once, and parse
  // each source PDF once however many of its pages are used.
  type Embedded = { kind: 'image'; image: PDFImage } | { kind: 'page'; page: PDFEmbeddedPage }
  const embedded = new Map<string, Embedded>()
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
  /** What a page embeds: its asset, filtered or not. PDF pages ignore filters. */
  const embed = async (asset: BuildInput['assets'][string], filter: Filter) => {
    const filtered = filter !== 'original' && asset.format !== 'pdf'
    const key = filtered ? `${asset.id}:${filter}` : asset.id
    const cached = embedded.get(key)
    if (cached) return cached
    let content: Embedded
    if (filtered) {
      if (!options.filterImage) throw new Error('This build can’t apply image filters.')
      const out = await options.filterImage(await options.getBytes(asset.bytesId), filter)
      const image =
        out.format === 'jpeg' ? await doc.embedJpg(out.bytes) : await doc.embedPng(out.bytes)
      content = { kind: 'image', image }
    } else if (asset.format === 'pdf') {
      const src = await source(asset.bytesId)
      const srcPage = src.getPage(asset.pdfPage ?? 0)
      content = { kind: 'page', page: await doc.embedPage(srcPage, visibleBox(srcPage)) }
    } else {
      const bytes = await options.getBytes(asset.bytesId)
      const image = asset.format === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
      content = { kind: 'image', image }
    }
    embedded.set(key, content)
    return content
  }

  for (const [index, page] of pages.entries()) {
    const asset = assets[page.assetId]
    if (!asset) throw new Error(`Page ${index + 1} refers to missing content.`)
    const layout = layoutPage(settings, asset, page)
    const pdfPage = doc.addPage([layout.page.width, layout.page.height])
    const content = await embed(asset, page.filter)
    const box = layout.content
    // A filtered image was decoded upright, so it has no stored turns left.
    const filtered = page.filter !== 'original' && asset.format !== 'pdf'
    const at = placement(layout, filtered ? 0 : asset.storedTurns)

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
    options.onProgress?.(index + 1, pages.length)
  }

  return doc.save({ useObjectStreams: true })
}
