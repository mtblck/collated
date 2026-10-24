import { picturesOf, type Asset, type Page } from './model'

/**
 * Bookmarks for the exported PDF (#75). The sources' own outlines are
 * dropped on import (see pdfSanitize), so Collated writes its own: a named
 * section where a page starts one, and optionally one bookmark per imported
 * file. Sections belong to their page (`Page.section`), so they move with it.
 *
 * Plain data, built where the file names are (the UI) and written by
 * core/pdf.ts in the worker.
 */
export interface OutlineItem {
  title: string
  /** The page it opens at. */
  pageId: string
  /** File bookmarks under a section. */
  children: OutlineItem[]
}

/** Longest section name, in characters. */
export const SECTION_MAX = 120

/** A page's section name as it goes in the PDF; '' when it starts none. */
export const sectionTitle = (page: Pick<Page, 'section'>) => page.section?.trim() ?? ''

/**
 * What a file's bookmark is called: its name without the extension, and for
 * a page of a PDF without the " · p3" its pages are named with.
 */
export const fileTitle = (asset: Pick<Asset, 'name' | 'format'>) => {
  const name = asset.format === 'pdf' ? asset.name.replace(/ · p\d+$/, '') : asset.name
  return name.replace(/\.[a-z0-9]{1,5}$/i, '') || name
}

/**
 * The section a page is in, from the whole document: the last one started
 * before it. A file that starts mid-section (a split part, a selection)
 * opens with that section's bookmark, so its pages stay under their heading.
 */
export const sectionBefore = (docPages: readonly Page[], pageId: string): string | null => {
  let current: string | null = null
  for (const page of docPages) {
    if (page.id === pageId) return current
    const title = sectionTitle(page)
    if (title) current = title
  }
  return null
}

/**
 * The outline of one exported file, from its pages in order. With `files`,
 * each imported file gets a bookmark at the first page that shows it,
 * under the section it falls in (again in each section it appears in).
 * `carried` is the section already running at the first page (see
 * `sectionBefore`). Empty when there is nothing to mark.
 */
export const buildOutline = (
  pages: readonly Page[],
  assets: Record<string, Pick<Asset, 'name' | 'format' | 'bytesId'>>,
  options: { files: boolean; carried?: string | null },
): OutlineItem[] => {
  const top: OutlineItem[] = []
  let section: OutlineItem | null = null
  let seen = new Set<string>()
  for (const [i, page] of pages.entries()) {
    const title = sectionTitle(page) || (i === 0 ? (options.carried ?? '') : '')
    if (title) {
      section = { title, pageId: page.id, children: [] }
      top.push(section)
      seen = new Set()
    }
    if (!options.files) continue
    for (const slot of picturesOf(page)) {
      const asset = assets[slot.assetId]
      if (!asset || seen.has(asset.bytesId)) continue
      seen.add(asset.bytesId)
      ;(section?.children ?? top).push({ title: fileTitle(asset), pageId: page.id, children: [] })
    }
  }
  return top
}
