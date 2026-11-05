export type TiffRequest =
  /** Reads the file's pages; their pixels are decoded one `page` request at a time. */
  { type: 'open'; bytes: ArrayBuffer } | { type: 'page'; index: number }

export type TiffPage =
  /** Black and white, as a 1-bit PNG: kept that way into the PDF. */
  | {
      kind: 'png'
      bytes: Uint8Array<ArrayBuffer>
      width: number
      height: number
      dpi: number | null
    }
  /** Anything else, upright, for the page to encode. */
  | {
      kind: 'rgba'
      pixels: Uint8ClampedArray<ArrayBuffer>
      width: number
      height: number
      dpi: number | null
    }

export type TiffResponse =
  | { ok: true; type: 'open'; pages: number }
  | { ok: true; type: 'page'; page: TiffPage }
  /**
   * `reason` picks the message the person sees; `tooLarge` is a page over
   * the import cap, refused before anything was decoded.
   */
  | {
      ok: false
      message: string
      reason?: 'bigtiff' | 'too-many-pages' | 'no-pages' | 'colour' | 'damaged'
      pages?: number
      tooLarge?: { width: number; height: number }
    }
