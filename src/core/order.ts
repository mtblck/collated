import type { Asset, DocState, Page } from './model'

/**
 * Page order tools for two-sided scans (#67): interleaving a pile of fronts
 * with a pile of backs, reversing, and sorting. Each works on a set of pages
 * and puts the reordered set back into the positions that set held, so pages
 * outside it stay where they are.
 */

export type SortKey = 'name' | 'date'

/** Which import a page came from: a PDF's own bytes, or the batch of images it was added with. */
const sourceOf = (asset: Asset | undefined) => asset?.source ?? asset?.bytesId ?? ''

/** Writes `ordered` into the slots that its pages occupy now, in order. */
const placeInSlots = (state: DocState, ordered: Page[]): DocState => {
  const moving = new Set(ordered.map((p) => p.id))
  let next = 0
  const pages = state.pages.map((p) => (moving.has(p.id) ? (ordered[next++] ?? p) : p))
  return pages.every((p, i) => p === state.pages[i]) ? state : { ...state, pages }
}

const pick = (state: DocState, ids: readonly string[]) => {
  const byId = new Map(state.pages.map((p) => [p.id, p]))
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    const page = byId.get(id)
    if (!page || seen.has(id)) return []
    seen.add(id)
    return [page]
  })
}

/** The given pages, or every page, in document order. */
const pagesIn = (state: DocState, ids?: readonly string[]) => {
  if (!ids) return state.pages
  const wanted = new Set(ids)
  return state.pages.filter((p) => wanted.has(p.id))
}

/**
 * Alternates fronts and backs: front 1, back 1, front 2, back 2… Backs from a
 * sheet-fed scanner come out last page first, so `backsReversed` reads them
 * from the end. When one pile is longer, its extra pages go at the end.
 */
export const interleave = (
  state: DocState,
  frontIds: readonly string[],
  backIds: readonly string[],
  backsReversed: boolean,
): DocState => {
  const fronts = pick(state, frontIds)
  const frontSet = new Set(fronts.map((p) => p.id))
  const backs = pick(state, backIds).filter((p) => !frontSet.has(p.id))
  if (fronts.length === 0 || backs.length === 0) return state
  if (backsReversed) backs.reverse()
  const paired = Array.from({ length: Math.min(fronts.length, backs.length) }, (_, i) => [
    fronts[i],
    backs[i],
  ]).flat() as Page[]
  const extra = fronts.length > backs.length ? fronts : backs
  return placeInSlots(state, [...paired, ...extra.slice(paired.length / 2)])
}

/** Reverses the given pages (default all) within the positions they hold. */
export const reverse = (state: DocState, ids?: readonly string[]): DocState =>
  placeInSlots(state, pagesIn(state, ids).toReversed())

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Sorts the given pages (default all) by file name, numbers in names counted
 * as numbers (scan 9 before scan 10), or by when they were taken. Ties keep
 * their current order; pages with no date go last, and inserted blank pages
 * stay where they are.
 */
export const sort = (state: DocState, key: SortKey, ids?: readonly string[]): DocState => {
  const asset = (p: Page) => state.assets[p.assetId]
  const compare =
    key === 'name'
      ? (a: Page, b: Page) => collator.compare(asset(a)?.name ?? '', asset(b)?.name ?? '')
      : (a: Page, b: Page) =>
          // Two undated pages give NaN: a tie.
          (asset(a)?.capturedAt ?? Infinity) - (asset(b)?.capturedAt ?? Infinity) || 0
  // Blank pages (#80) have no name or date: they keep their places.
  return placeInSlots(
    state,
    pagesIn(state, ids)
      .filter((p) => !p.blank)
      .toSorted(compare),
  )
}

export interface DuplexGroups {
  fronts: string[]
  backs: string[]
  /** How the piles were chosen, for the dialog to say so. */
  by: 'imports' | 'halves'
  /** Names of the two blocks (by their first file), when chosen by blocks. */
  names?: [string, string]
}

/**
 * How to split pages into fronts and backs: the given pages (selected, #65)
 * or the whole document. Two blocks are the two piles: two separate runs of
 * selected pages, or for the whole document two imports one after the other
 * (fronts.pdf then backs.pdf, or two batches of photos). Otherwise the first half
 * is fronts (the extra page, if the count is odd) and the second half backs.
 * Null with fewer than two pages.
 */
export const duplexGroups = (state: DocState, ids?: readonly string[]): DuplexGroups | null => {
  const pages = pagesIn(state, ids)
  if (pages.length < 2) return null
  const index = new Map(state.pages.map((p, i) => [p.id, i]))
  const runs: Page[][] = []
  for (const page of pages) {
    const run = runs.at(-1)
    const last = run?.at(-1)
    // Selected pages split where the selection has a gap; the whole
    // document where one import ends and the next begins.
    const together =
      last &&
      (ids
        ? index.get(last.id) === (index.get(page.id) ?? 0) - 1
        : sourceOf(state.assets[last.assetId]) === sourceOf(state.assets[page.assetId]))
    if (run && together) run.push(page)
    else runs.push([page])
  }
  const [a, b] = runs
  if (runs.length === 2 && a && b) {
    const label = (run: Page[]) => {
      const first = state.assets[run[0]?.assetId ?? '']
      // A PDF's pages are named "file · p3"; a batch of photos by its first.
      const name = first?.name.replace(/ · p\d+$/, '') ?? ''
      return first?.format === 'pdf' || run.length === 1 ? name : `${name} and others`
    }
    return {
      fronts: a.map((p) => p.id),
      backs: b.map((p) => p.id),
      by: 'imports',
      names: [label(a), label(b)],
    }
  }
  const half = Math.ceil(pages.length / 2)
  return {
    fronts: pages.slice(0, half).map((p) => p.id),
    backs: pages.slice(half).map((p) => p.id),
    by: 'halves',
  }
}
