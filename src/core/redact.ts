import { rotatedBounds } from './geometry'
import { picturesOf, type Asset, type Page, type Redaction } from './model'
import { apply, homography, FULL_IMAGE, type Point, type Quad } from './perspective'
import type { OcrWord } from './textLayer'

/**
 * Blacking out (#77). A redaction is a rectangle of the upright image, so it
 * stays on what it covers whatever the crop, turn or fit. What's under it is
 * removed, not covered: the export paints the source pixels before cropping
 * or filtering, draws a PDF page as a picture, and drops recognised words
 * that touch it. Pure geometry here; the painting is in lib/filterCanvas.ts.
 */

/** Smaller than this share of a side isn't a box anyone meant to draw. */
export const MIN_SIDE = 0.005

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** In order and inside the image, without slivers; drops what's left with no area. */
export const cleanRedactions = (boxes: readonly Redaction[]): Redaction[] =>
  boxes.flatMap((box) => {
    const x0 = clamp01(Math.min(box.x0, box.x1))
    const x1 = clamp01(Math.max(box.x0, box.x1))
    const y0 = clamp01(Math.min(box.y0, box.y1))
    const y1 = clamp01(Math.max(box.y0, box.y1))
    if (![x0, x1, y0, y1].every(Number.isFinite)) return []
    return x1 - x0 >= MIN_SIDE && y1 - y0 >= MIN_SIDE ? [{ x0, y0, x1, y1 }] : []
  })

/** A box's corners, top-left first, clockwise. */
export const boxCorners = (box: Redaction): Quad => [
  { x: box.x0, y: box.y0 },
  { x: box.x1, y: box.y0 },
  { x: box.x1, y: box.y1 },
  { x: box.x0, y: box.y1 },
]

/**
 * Each box as the page shows its content: fractions of the flattened crop
 * when there are corners (a rectangle of the photo is a quadrilateral of the
 * flattened page), else of the image. A vector page has no crop.
 */
export const redactionShapes = (
  boxes: readonly Redaction[] | undefined,
  corners: Quad | null,
): Quad[] => {
  if (!boxes?.length) return []
  if (!corners) return boxes.map(boxCorners)
  const toContent = homography(corners, FULL_IMAGE)
  return boxes.map((box) => {
    const [a, b, c, d] = boxCorners(box).map((p) => apply(toContent, p))
    return [a ?? FULL_IMAGE[0], b ?? FULL_IMAGE[1], c ?? FULL_IMAGE[2], d ?? FULL_IMAGE[3]]
  })
}

/** What each picture of a page blacks out, as it shows it (for the preview). */
export const pageCovers = (
  page: Page,
  assets: Readonly<Record<string, Pick<Asset, 'format'> | undefined>>,
): Quad[][] =>
  picturesOf(page).map((slot) =>
    redactionShapes(slot.redactions, assets[slot.assetId]?.format === 'pdf' ? null : slot.corners),
  )

/**
 * Content fractions → fractions of the displayed (turned and straightened)
 * content's bounding box: the space recognised words are in (core/textLayer.ts).
 */
export const toDisplayed = (p: Point, width: number, height: number, rotation: number): Point => {
  const bounds = rotatedBounds(width, height, rotation)
  const r = (rotation * Math.PI) / 180
  const lx = (p.x - 0.5) * width
  const ly = (p.y - 0.5) * height
  return {
    x: 0.5 + (lx * Math.cos(r) - ly * Math.sin(r)) / bounds.width,
    y: 0.5 + (lx * Math.sin(r) + ly * Math.cos(r)) / bounds.height,
  }
}

/**
 * The words that keep clear of every box. A word that touches one is
 * dropped whole: its text could be what the box hides. Tested against each
 * shape's bounding box as displayed, which on a straightened page is a little
 * more than the box, never less.
 */
export const wordsClear = (
  words: readonly OcrWord[],
  shapes: readonly Quad[],
  content: { width: number; height: number; rotation: number },
): OcrWord[] => {
  if (!shapes.length) return [...words]
  const boxes = shapes.map((shape) => {
    const pts = shape.map((p) => toDisplayed(p, content.width, content.height, content.rotation))
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
  })
  return words.filter(
    (w) => !boxes.some((b) => w.x0 < b.x1 && w.x1 > b.x0 && w.y0 < b.y1 && w.y1 > b.y0),
  )
}
