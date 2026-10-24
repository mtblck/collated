import type { Page } from './model'

/**
 * Which pages are selected (#65). Plain data, kept outside the document and
 * its undo history: selecting isn't an edit.
 *
 * `ids` are in document order. `anchor` is where a Shift range starts (the
 * last page clicked or toggled on) and the page the single-page inspector
 * shows when only one is selected.
 */
export interface Selection {
  ids: string[]
  anchor: string | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null }

/** How a pick extends the selection: replace it, toggle one page, or a range. */
export type PickMode = 'only' | 'toggle' | 'range'

const inOrder = (pages: readonly Page[], ids: Iterable<string>): string[] => {
  const set = new Set(ids)
  return pages.flatMap((p) => (set.has(p.id) ? [p.id] : []))
}

/** The pick mode a click's modifier keys ask for: Shift a range, ⌘ or Ctrl a toggle. */
export const pickModeOf = (event: {
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): PickMode => (event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'only')

export const pick = (
  pages: readonly Page[],
  selection: Selection,
  id: string,
  mode: PickMode,
): Selection => {
  if (!pages.some((p) => p.id === id)) return selection
  switch (mode) {
    case 'only':
      return { ids: [id], anchor: id }
    case 'toggle': {
      if (!selection.ids.includes(id)) {
        return { ids: inOrder(pages, [...selection.ids, id]), anchor: id }
      }
      const ids = selection.ids.filter((x) => x !== id)
      // The anchor moves to the nearest page still selected.
      const anchor = selection.anchor === id ? nearest(pages, ids, id) : selection.anchor
      return { ids, anchor }
    }
    case 'range': {
      const from = pages.findIndex((p) => p.id === selection.anchor)
      if (from < 0) return { ids: [id], anchor: id }
      const to = pages.findIndex((p) => p.id === id)
      const [lo, hi] = from < to ? [from, to] : [to, from]
      // Like a file manager: the range replaces the selection, anchor kept.
      return { ids: pages.slice(lo, hi + 1).map((p) => p.id), anchor: selection.anchor }
    }
  }
}

const nearest = (pages: readonly Page[], ids: readonly string[], from: string): string | null => {
  const at = pages.findIndex((p) => p.id === from)
  let best: string | null = null
  let distance = Infinity
  for (const id of ids) {
    const d = Math.abs(pages.findIndex((p) => p.id === id) - at)
    if (d < distance) [best, distance] = [id, d]
  }
  return best
}

export const selectAll = (pages: readonly Page[], selection: Selection): Selection => ({
  ids: pages.map((p) => p.id),
  anchor: selection.anchor ?? pages[0]?.id ?? null,
})

/** The selection with only pages that still exist, in their current order. */
export const keepExisting = (pages: readonly Page[], selection: Selection): Selection => {
  const ids = inOrder(pages, selection.ids)
  if (ids.length === selection.ids.length && ids.every((id, i) => id === selection.ids[i])) {
    return selection
  }
  const anchor =
    selection.anchor !== null && ids.includes(selection.anchor)
      ? selection.anchor
      : (ids[0] ?? null)
  return { ids, anchor }
}

/**
 * Where a block of selected pages goes when one of them is dragged from
 * `from` to `to` (indices in the whole list): the index, among the pages
 * left once the block is lifted out, to insert the block at. The dragged
 * page lands where it was dropped; the rest of the block close up around it.
 */
export const blockDropIndex = (
  pages: readonly Page[],
  ids: readonly string[],
  from: number,
  to: number,
): number => {
  const dragged = pages[from]
  if (!dragged) return 0
  const order = pages.toSpliced(from, 1).toSpliced(to, 0, dragged)
  const selected = new Set(ids)
  const before = order.slice(0, order.indexOf(dragged))
  return before.filter((p) => !selected.has(p.id)).length
}
