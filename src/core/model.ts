import { toPixels, warpSize, type Quad } from './perspective'

/**
 * The document model. Everything here is plain data so the reducer, the
 * preview and the PDF export can all be tested without a browser.
 *
 * Lengths are PDF points (1/72 in) throughout; units only appear at the UI edge.
 */

export type Unit = 'mm' | 'in'

/** `image`: each page is sized to its own content (images at `imageDpi`, PDF pages as they are). */
export type PageSizeId = 'a3' | 'a4' | 'a5' | 'letter' | 'legal' | 'tabloid' | 'custom' | 'image'

/** `auto` picks portrait or landscape per page to match the (rotated) image. */
export type Orientation = 'auto' | 'portrait' | 'landscape'

/** `contain` shows the whole image; `cover` fills the printable area and crops. */
export type FitMode = 'contain' | 'cover'

/**
 * How a page's image is tidied for a document: as shot, greyscale, or black
 * and white (an adaptive threshold that keeps text crisp under uneven light).
 * Images only; PDF pages are vector and pass through untouched.
 */
export type Filter = 'original' | 'grey' | 'enhance' | 'bw'

export type QuarterTurns = 0 | 1 | 2 | 3

/**
 * How images are stored in the PDF. `original` keeps them byte-for-byte; the
 * others cap each image's printed resolution and re-encode it as JPEG.
 */
export type Quality = 'original' | 'high' | 'balanced' | 'small'

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'top-right'

export interface PageNumbers {
  show: boolean
  position: NumberPosition
  /** The number printed on the first page. */
  start: number
}

export interface Settings {
  size: PageSizeId
  /** Used when size is `custom`; width and height in points. */
  custom: { width: number; height: number }
  /** Display unit for custom size and margin. */
  unit: Unit
  orientation: Orientation
  /** Blank border on every side, in points. Images are clipped to it. */
  margin: number
  /** PDF title metadata and the download filename. */
  title: string
  quality: Quality
  /** Optional ceiling on the exported file, in bytes; lower quality steps are tried to meet it. */
  maxBytes: number | null
  /** Pixels per inch for `image`-sized pages. */
  imageDpi: number
  pageNumbers: PageNumbers
  /** Recognise text (on this device) and add an invisible, searchable layer. */
  ocr: boolean
  /** Bookmark each imported file at its first page (#75). Missing in work saved before. */
  bookmarkFiles: boolean
}

/**
 * Metadata for one imported page source: an image, or one page of a PDF. The
 * bytes live outside React state (see import/assetStore.ts) because they can
 * be tens of megabytes each.
 */
export interface Asset {
  id: string
  name: string
  /**
   * Upright size: pixels for images (after EXIF orientation), points for PDF
   * pages (after the page's /Rotate).
   */
  width: number
  height: number
  /** How the stored bytes are embedded in the PDF. */
  format: 'jpeg' | 'png' | 'pdf'
  /**
   * Key of the stored bytes. Its own id for images; every page of an imported
   * PDF shares the PDF's bytes.
   */
  bytesId: string
  /** For `pdf` assets, the zero-based page in the source PDF. */
  pdfPage?: number
  /**
   * Clockwise rotation, in quarter turns, that the stored content needs to
   * appear upright. JPEGs kept byte-for-byte carry their EXIF orientation here
   * and PDF pages their /Rotate: the embedded content is unrotated either way,
   * so the export applies it.
   */
  storedTurns: QuarterTurns
  /** Object URL of a small upright JPEG preview. */
  thumbUrl: string
  /** Size of the stored bytes, for display (the whole file for a PDF page). */
  byteLength: number
  /**
   * When it was taken, in ms since the epoch: the photo's EXIF
   * DateTimeOriginal, else the file's modified date. For sorting.
   */
  capturedAt?: number
  /**
   * Which import it came from, for telling a pile of fronts from a pile of
   * backs: images added together share one. PDF pages go by `bytesId`.
   */
  source?: string
}

/** PDF pages are vector: printed resolution doesn't apply. */
export const isVector = (asset: Pick<Asset, 'format'>) => asset.format === 'pdf'

export interface Page {
  id: string
  assetId: string
  /** Clockwise quarter turns applied by the user. */
  turns: QuarterTurns
  /** Fine clockwise rotation in degrees, for straightening a skewed scan. */
  angle: number
  /** Multiplier on the fitted size: 1 is exactly fitted. */
  scale: number
  fit: FitMode
  filter: Filter
  /**
   * The paper's corners in the upright image, as fractions (0–1), in order
   * top-left, top-right, bottom-right, bottom-left; null for the whole image.
   * The page then shows that quadrilateral flattened to a rectangle.
   */
  corners: Quad | null
  /**
   * Areas to black out (#77), as rectangles of the upright image in fractions
   * (0–1), the space `corners` use, so a later crop doesn't move them off
   * what they cover. The export removes what's under them: image pixels are
   * painted over before anything else, a PDF page goes as a drawing, and
   * recognised words under them are dropped. Unset or empty: none. Reset
   * keeps them; only the editor takes them away.
   */
  redactions?: readonly Redaction[]
  /**
   * Set when several pictures share this page (#76). The page's own
   * `assetId` is then its first picture's and its own look is unused: each
   * picture keeps its rotation, crop and filter in its slot. Sorting and
   * duplex ordering go by `assetId`, so by the first picture.
   */
  sheet?: Sheet
  /**
   * Names a section that starts at this page: a bookmark in the exported
   * PDF (#75). As typed; trimmed on export, and blank starts none. It
   * belongs to the page, so it moves when the page does.
   */
  section?: string
}

/**
 * How a combined page is laid out: `two` stacked along the page's long side,
 * `four` in a 2 × 2 grid, `id-card` both sides of a card at real size.
 */
export type SheetKind = 'two' | 'four' | 'id-card'

/** How many pictures each kind of sheet holds. */
export const SHEET_CAPACITY: Record<SheetKind, number> = { two: 2, four: 4, 'id-card': 2 }

/** One picture on a combined page: what a page is, less its id. */
export type Slot = Pick<Page, 'assetId'> & PageTransform

export interface Sheet {
  kind: SheetKind
  /** In reading order: left to right, then top to bottom. */
  slots: Slot[]
}

/** The pictures a page shows: its slots when combined, else the page itself. */
export const picturesOf = (page: Page): readonly Slot[] => page.sheet?.slots ?? [page]

/**
 * The key a picture's recognised words go under: the page id, plus the
 * slot's position on a combined page.
 */
export const pictureKey = (page: Pick<Page, 'id' | 'sheet'>, slot: number) =>
  page.sheet ? `${page.id}/${String(slot)}` : page.id

export type PageTransform = Pick<
  Page,
  'turns' | 'angle' | 'scale' | 'fit' | 'filter' | 'corners' | 'redactions'
>

/** A rectangle to black out, as fractions of the upright image (see `Page.redactions`). */
export interface Redaction {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Whether a picture has anything to black out. */
export const isRedacted = (picture: Pick<Page, 'redactions'>) =>
  (picture.redactions?.length ?? 0) > 0

export const DEFAULT_TRANSFORM: PageTransform = {
  turns: 0,
  angle: 0,
  scale: 1,
  fit: 'contain',
  filter: 'original',
  corners: null,
}

/**
 * The pixel size of what a page shows: the whole image, or the corrected
 * rectangle when it has corners. PDF pages ignore corners (they're vector).
 */
export const contentSize = (
  asset: Pick<Asset, 'width' | 'height'> & Partial<Pick<Asset, 'format'>>,
  page: Partial<Pick<Page, 'corners'>>,
) =>
  page.corners && asset.format !== 'pdf'
    ? warpSize(toPixels(page.corners, asset.width, asset.height))
    : { width: asset.width, height: asset.height }

export const ANGLE_LIMIT = 45
export const SCALE_MIN = 0.1
export const SCALE_MAX = 4

export interface DocState {
  settings: Settings
  assets: Record<string, Asset>
  pages: Page[]
}

/** Total clockwise rotation of a page, in degrees. */
export const pageRotation = (page: Pick<Page, 'turns' | 'angle'>): number =>
  page.turns * 90 + page.angle
