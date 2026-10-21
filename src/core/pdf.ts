import {
  PDFDocument,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  type PDFImage,
} from '@cantoo/pdf-lib'
import { layoutPage, type Layout } from './geometry'
import type { Asset, Page, Settings } from './model'

export interface BuildInput {
  settings: Settings
  pages: Page[]
  assets: Record<string, Pick<Asset, 'id' | 'width' | 'height' | 'format' | 'storedTurns'>>
}

export interface BuildOptions {
  /** Returns the stored bytes for an asset (the same bytes imported). */
  getBytes: (assetId: string) => Uint8Array | Promise<Uint8Array>
  onProgress?: (done: number, total: number) => void
  /** Fixed for reproducible output in tests. */
  now?: Date
}

export const PRODUCER = 'Collated — mattblack.space/tools/collated'

/**
 * Where to put the stored image's bottom-left corner, and its size and
 * counter-clockwise rotation, in PDF space (origin bottom-left, y up).
 *
 * The layout describes the upright image in screen space. JPEGs kept
 * byte-for-byte may be stored sideways (EXIF orientation), so their stored
 * size is the upright size swapped and their rotation gains `storedTurns`.
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

export const buildPdf = async (input: BuildInput, options: BuildOptions): Promise<Uint8Array> => {
  const { settings, pages, assets } = input
  const now = options.now ?? new Date()
  const doc = await PDFDocument.create()
  doc.setTitle(settings.title.trim() || 'Collated scans', { showInWindowTitleBar: true })
  doc.setCreator('Collated')
  doc.setProducer(PRODUCER)
  doc.setCreationDate(now)
  doc.setModificationDate(now)

  // A duplicated page shares its image: embed each asset once.
  const embedded = new Map<string, PDFImage>()
  const embed = async (asset: BuildInput['assets'][string]) => {
    const cached = embedded.get(asset.id)
    if (cached) return cached
    const bytes = await options.getBytes(asset.id)
    const image = asset.format === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes)
    embedded.set(asset.id, image)
    return image
  }

  for (const [index, page] of pages.entries()) {
    const asset = assets[page.assetId]
    if (!asset) throw new Error(`Page ${index + 1} refers to a missing image.`)
    const layout = layoutPage(settings, asset, page)
    const pdfPage = doc.addPage([layout.page.width, layout.page.height])
    const image = await embed(asset)
    const { content } = layout
    const at = placement(layout, asset.storedTurns)

    // Clip to the printable area so a scaled-up or filled image never prints
    // into the margins — the preview clips the same way.
    pdfPage.pushOperators(
      pushGraphicsState(),
      rectangle(
        content.x,
        layout.page.height - content.y - content.height,
        content.width,
        content.height,
      ),
      clip(),
      endPath(),
    )
    pdfPage.drawImage(image, { ...at, rotate: degrees(at.rotate) })
    pdfPage.pushOperators(popGraphicsState())
    options.onProgress?.(index + 1, pages.length)
  }

  return doc.save({ useObjectStreams: true })
}
