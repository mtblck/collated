import type { Page } from './model'

/**
 * Which pages an export takes, and into how many files (#66): every page as
 * one PDF, only the selected pages, or the document split by page ranges or
 * every N pages. Several files download together as one ZIP.
 */
export type SplitMode = 'all' | 'selection' | 'ranges' | 'every'

export interface SplitOptions {
  mode: SplitMode
  /** As typed, e.g. "1-3, 4-10, 11-". Page numbers are 1-based. */
  ranges: string
  every: number
  /**
   * Page numbers in each file: from the starting number again, or carrying
   * on from where the previous file stopped.
   */
  numbering: 'restart' | 'continue'
}

export const DEFAULT_SPLIT: SplitOptions = {
  mode: 'all',
  ranges: '',
  every: 1,
  numbering: 'restart',
}

/** One output file: its pages in order, and the number printed on its first page. */
export interface Part {
  pageIds: string[]
  /** The 1-based document positions of its pages, for describing it. */
  positions: number[]
  start: number
}

export type Plan = { parts: Part[] } | { error: string }

/** A range of 1-based page positions, both ends included. */
export type Range = readonly [from: number, to: number]

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/**
 * Reads "1-3, 4-10" into ranges. Commas, semicolons or spaces separate them;
 * "8-" runs to the last page and "-3" from the first. Ranges may overlap or
 * come in any order: each is one file, in the order written.
 */
export const parseRanges = (
  text: string,
  pageCount: number,
): { ranges: Range[] } | { error: string } => {
  const tokens = text
    .replace(/\s*[-–—]\s*/g, '-')
    .split(/[\s,;]+/)
    .filter(Boolean)
  if (tokens.length === 0) return { error: 'Enter page ranges, like 1-3, 4-10.' }
  const ranges: Range[] = []
  for (const token of tokens) {
    const match = /^(\d+)?(-)?(\d+)?$/.exec(token)
    if (!match || (!match[1] && !match[3])) {
      return { error: `“${token}” isn’t a page or a range. Write them like 1-3, 4-10.` }
    }
    const [, a, dash, b] = match
    const from = a ? Number(a) : 1
    const to = b ? Number(b) : dash ? pageCount : from
    if (from < 1 || to < 1) return { error: 'Pages are numbered from 1.' }
    const past = Math.max(from, to)
    if (past > pageCount) {
      return {
        error: `There’s no page ${String(past)}: the document has ${plural(pageCount, 'page')}.`,
      }
    }
    if (from > to) {
      return { error: `${token} runs backwards. Write ${String(to)}-${String(from)}.` }
    }
    ranges.push([from, to])
  }
  return { ranges }
}

/** Page positions as a short list: [1, 3, 4, 5] → "1, 3–5". */
export const positionList = (positions: readonly number[]): string => {
  const runs: string[] = []
  let i = 0
  while (i < positions.length) {
    let j = i
    while (j + 1 < positions.length && positions[j + 1] === (positions[j] ?? 0) + 1) j += 1
    const first = String(positions[i])
    runs.push(j > i ? `${first}–${String(positions[j])}` : first)
    i = j + 1
  }
  return runs.join(', ')
}

/** The files an export makes, or why it can't be made as asked. */
export const planExport = (
  pages: readonly Page[],
  selectedIds: readonly string[],
  options: SplitOptions,
  numberStart: number,
): Plan => {
  if (pages.length === 0) return { error: 'There are no pages to export.' }
  let groups: number[][]
  switch (options.mode) {
    case 'all':
      groups = [pages.map((_, i) => i + 1)]
      break
    case 'selection': {
      const selected = new Set(selectedIds)
      const positions = pages.flatMap((p, i) => (selected.has(p.id) ? [i + 1] : []))
      if (positions.length === 0) return { error: 'Select the pages to export first.' }
      groups = [positions]
      break
    }
    case 'ranges': {
      const parsed = parseRanges(options.ranges, pages.length)
      if ('error' in parsed) return parsed
      groups = parsed.ranges.map(([from, to]) =>
        Array.from({ length: to - from + 1 }, (_, i) => from + i),
      )
      break
    }
    case 'every': {
      const n = Math.floor(options.every)
      if (!(n >= 1)) return { error: 'Split every 1 page or more.' }
      groups = []
      for (let i = 0; i < pages.length; i += n) {
        groups.push(Array.from({ length: Math.min(n, pages.length - i) }, (_, k) => i + k + 1))
      }
      break
    }
  }
  let next = numberStart
  const parts = groups.map((positions) => {
    const start = options.numbering === 'continue' ? next : numberStart
    next = start + positions.length
    return {
      positions,
      pageIds: positions.flatMap((n) => pages[n - 1]?.id ?? []),
      start,
    }
  })
  return { parts }
}

/** The plan in a sentence, for the export options (null for the plain one-file export). */
export const describePlan = (plan: Plan, mode: SplitMode): string | null => {
  if ('error' in plan) return plan.error
  const [only] = plan.parts
  if (plan.parts.length === 1 && only) {
    if (mode === 'all') return null
    return `${only.positions.length === 1 ? 'Page' : 'Pages'} ${positionList(only.positions)}, as one PDF.`
  }
  const shown = plan.parts.slice(0, 6).map((p) => positionList(p.positions))
  const more = plan.parts.length - shown.length
  return `${String(plan.parts.length)} PDFs in one ZIP: pages ${shown.join(' · ')}${
    more > 0 ? ` and ${String(more)} more` : ''
  }.`
}

/** Each page used once, in the order it first appears across the parts. */
export const pagesUsed = (plan: { parts: readonly Part[] }): string[] => [
  ...new Set(plan.parts.flatMap((p) => p.pageIds)),
]
