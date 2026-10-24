import { zipSync, type Zippable } from 'fflate'
import type { Compression, FitResult } from './compression'
import type { BuildInput } from './pdf'
import type { OutlineItem } from './outline'
import { NeedsDrawing } from './pdfSanitize'

/** One file of a split export (#66): its pages by id, in order. */
export interface SplitPart {
  name: string
  pageIds: string[]
  /** The number printed on its first page, when page numbers are on. */
  start: number
  /** Its own bookmarks (#75): each file opens under the section its first page is in. */
  outline?: OutlineItem[]
}

/** The smaller of two compression steps; null (original images) is the largest. */
const smaller = (a: Compression | null, b: Compression | null) =>
  a === null ? b : b === null ? a : b.dpi < a.dpi ? b : a

/**
 * Builds each part as its own PDF with the same settings (quality, size
 * limit, OCR text, password; page numbers from the part's `start`, bookmarks
 * from its `outline`) and packs
 * them into one ZIP, stored rather than deflated: PDF content is compressed
 * already. `build` makes one PDF, as a single export would; its progress is
 * counted across all the parts.
 *
 * Every part is tried before giving up on pages that must be drawn first, so
 * the export draws them all and builds once more, as for one file.
 */
export const buildSplit = async (
  input: BuildInput,
  parts: readonly SplitPart[],
  build: (
    input: BuildInput,
    onProgress: (done: number, total: number) => void,
  ) => Promise<FitResult>,
  onProgress?: (done: number, total: number) => void,
): Promise<FitResult> => {
  const byId = new Map(input.pages.map((p) => [p.id, p]))
  const total = parts.reduce((n, part) => n + part.pageIds.length, 0)
  const files: Zippable = {}
  const draw = new Set<string>()
  let offset = 0
  let fits = true
  let compression: Compression | null = null
  for (const part of parts) {
    const pages = part.pageIds.map((id) => {
      const page = byId.get(id)
      if (!page) throw new Error(`Missing page ${id}.`)
      return page
    })
    const settings = {
      ...input.settings,
      pageNumbers: { ...input.settings.pageNumbers, start: part.start },
    }
    try {
      const { outline: _, ...shared } = input
      const own = part.outline?.length ? { outline: part.outline } : {}
      const result = await build({ ...shared, ...own, settings, pages }, (done) => {
        onProgress?.(offset + done, total)
      })
      files[part.name] = [result.pdf, { level: 0 }]
      fits &&= result.fits
      compression = smaller(compression, result.compression)
    } catch (error) {
      if (!(error instanceof NeedsDrawing)) throw error
      for (const id of error.assetIds) draw.add(id)
    }
    offset += pages.length
  }
  if (draw.size) throw new NeedsDrawing([...draw])
  return { pdf: zipSync(files), compression, fits }
}
