import type { DocState } from './model'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Length of the longest increasing subsequence (patience sorting). */
const longestKeptOrder = (positions: number[]): number => {
  const tails: number[] = []
  for (const x of positions) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((tails[mid] ?? 0) < x) lo = mid + 1
      else hi = mid
    }
    tails[lo] = x
  }
  return tails.length
}

/**
 * A short, lower-case description of what changed from `before` to `after`,
 * for announcing undo and redo ("Undone: removed page 2."). Worked out from
 * the two states, so the undo history needn't carry labels. Null when
 * nothing a person would recognise changed.
 */
export const describeChange = (before: DocState, after: DocState): string | null => {
  const was = before.pages
  const now = after.pages
  const wasIds = new Set(was.map((p) => p.id))
  const nowIds = new Set(now.map((p) => p.id))
  const added = now.filter((p) => !wasIds.has(p.id))
  const removed = was.filter((p) => !nowIds.has(p.id))

  if (added.length > 0 && removed.length === 0) {
    const first = now.findIndex((p) => p.id === added[0]?.id)
    if (added.length === 1) return `added ${added[0]?.blank ? 'blank ' : ''}page ${first + 1}`
    return `added ${plural(added.length, 'page')}`
  }
  if (removed.length > 0 && added.length === 0) {
    const first = was.findIndex((p) => p.id === removed[0]?.id)
    return removed.length === 1
      ? `removed page ${first + 1}`
      : `removed ${plural(removed.length, 'page')}`
  }
  if (added.length > 0) {
    // Combined pages (#76): pictures went onto fewer pages, or came back off one.
    if (added.every((p) => p.sheet) && removed.length > added.length) {
      return `combined ${plural(removed.length, 'page')}`
    }
    const [split] = removed
    if (split && removed.length === 1 && added.length === split.sheet?.slots.length) {
      return `split page ${was.indexOf(split) + 1}`
    }
    return 'changed the pages'
  }

  if (was.some((p, i) => now[i]?.id !== p.id)) {
    // Several pages moved together (#65): the fewest that could have moved
    // are the ones outside the longest run still in their old order.
    const moves = was.length - longestKeptOrder(was.map((p) => now.findIndex((q) => q.id === p.id)))
    if (moves > 1) return `moved ${plural(moves, 'page')}`
    // One page moved: the page whose position changed the most.
    let moved = { id: '', from: 0, to: 0, distance: -1 }
    for (const [from, p] of was.entries()) {
      const to = now.findIndex((q) => q.id === p.id)
      if (Math.abs(to - from) > moved.distance) {
        moved = { id: p.id, from, to, distance: Math.abs(to - from) }
      }
    }
    return `moved page ${moved.from + 1} to position ${moved.to + 1}`
  }

  const edited = now.flatMap((p, i) => (p === was[i] ? [] : [i]))
  if (edited.length === 1) return `edited page ${(edited[0] ?? 0) + 1}`
  if (edited.length > 1) return `edited ${plural(edited.length, 'page')}`

  if (before.settings !== after.settings) {
    const changed = (Object.keys(after.settings) as (keyof DocState['settings'])[]).filter(
      (key) => JSON.stringify(before.settings[key]) !== JSON.stringify(after.settings[key]),
    )
    const NAMES: Partial<Record<keyof DocState['settings'], string>> = {
      size: 'page size',
      custom: 'custom size',
      unit: 'units',
      orientation: 'orientation',
      margin: 'margin',
      title: 'title',
      quality: 'image quality',
      maxBytes: 'size limit',
      imageDpi: 'image dpi',
      pageNumbers: 'page numbers',
      watermark: 'watermark',
      ocr: 'searchable text',
    }
    const names = changed.flatMap((key) => NAMES[key] ?? [])
    return names.length === 1 ? `changed ${names[0] ?? ''}` : 'changed document settings'
  }
  return null
}
