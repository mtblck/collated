import { PAGE_MAX, PAGE_MIN } from './limits'
import { interleave, reverse, sort, type SortKey } from './order'
import { isConvex, type Point, type Quad } from './perspective'
import type { Asset, DocState, Page, PageTransform, QuarterTurns, Settings } from './model'
import { ANGLE_LIMIT, DEFAULT_TRANSFORM, SCALE_MAX, SCALE_MIN } from './model'

export { PAGE_MAX, PAGE_MIN }

export type Action =
  | { type: 'addPages'; assets: Asset[]; pageIds: string[]; at?: number }
  | { type: 'removePage'; id: string }
  | { type: 'duplicatePage'; id: string; newId: string }
  | { type: 'movePage'; from: number; to: number }
  | { type: 'rotatePage'; id: string; by: -1 | 1 }
  /*
   * Several selected pages at once (#65), each one undo step. `movePages`
   * lifts them out as a block, in document order, and puts the block at
   * `at` among the pages left; `shiftPages` moves each one place past its
   * unselected neighbour, as a list's Move up / Move down does.
   */
  | { type: 'removePages'; ids: string[] }
  | { type: 'duplicatePages'; ids: string[]; newIds: string[] }
  | { type: 'movePages'; ids: string[]; at: number }
  | { type: 'shiftPages'; ids: string[]; by: -1 | 1 }
  | { type: 'rotatePages'; ids: string[]; by: -1 | 1 }
  | { type: 'rotateAll'; by: -1 | 1 }
  | { type: 'transformPage'; id: string; patch: Partial<PageTransform> }
  /** Several pages at once, as one undo step (e.g. auto-straighten all). */
  | { type: 'transformPages'; patches: { id: string; patch: Partial<PageTransform> }[] }
  /** Alternates two piles of pages (a two-sided scan), in the slots they hold. */
  | { type: 'interleavePages'; fronts: string[]; backs: string[]; backsReversed: boolean }
  /** Reverses these pages, or every page, in the slots they hold. */
  | { type: 'reversePages'; ids?: string[] }
  | { type: 'sortPages'; by: SortKey; ids?: string[] }
  | { type: 'resetPage'; id: string }
  | { type: 'applyToAll'; id: string }
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'clear' }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const turn = (turns: QuarterTurns, by: number): QuarterTurns =>
  ((((turns + by) % 4) + 4) % 4) as QuarterTurns

const cleanTransform = (patch: Partial<PageTransform>): Partial<PageTransform> => {
  const out: Partial<PageTransform> = { ...patch }
  if (out.angle !== undefined) out.angle = clamp(out.angle, -ANGLE_LIMIT, ANGLE_LIMIT)
  if (out.scale !== undefined) out.scale = clamp(out.scale, SCALE_MIN, SCALE_MAX)
  if (out.turns !== undefined) out.turns = turn(0, Math.round(out.turns))
  if (out.corners) {
    const [a, b, c, d] = out.corners
    const inside = (p: Point) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })
    const corners: Quad = [inside(a), inside(b), inside(c), inside(d)]
    // A crossed or collapsed shape can't be flattened: ignore that edit.
    if (isConvex(corners)) out.corners = corners
    else delete out.corners
  }
  return out
}

const cleanSettings = (patch: Partial<Settings>): Partial<Settings> => {
  const out: Partial<Settings> = { ...patch }
  if (out.margin !== undefined) out.margin = clamp(out.margin, 0, PAGE_MAX / 2)
  if (out.custom) {
    out.custom = {
      width: clamp(out.custom.width, PAGE_MIN, PAGE_MAX),
      height: clamp(out.custom.height, PAGE_MIN, PAGE_MAX),
    }
  }
  return out
}

const mapPage = (state: DocState, id: string, fn: (page: Page) => Page): DocState => ({
  ...state,
  pages: state.pages.map((p) => (p.id === id ? fn(p) : p)),
})

export const docReducer = (state: DocState, action: Action): DocState => {
  switch (action.type) {
    case 'addPages': {
      const assets = { ...state.assets }
      for (const asset of action.assets) assets[asset.id] = asset
      const added = action.assets.map((asset, i): Page => ({
        id: action.pageIds[i] ?? `${asset.id}-page`,
        assetId: asset.id,
        ...DEFAULT_TRANSFORM,
      }))
      const at = clamp(action.at ?? state.pages.length, 0, state.pages.length)
      return { ...state, assets, pages: state.pages.toSpliced(at, 0, ...added) }
    }

    case 'removePage':
      // The asset is kept so undo can bring the page back.
      return { ...state, pages: state.pages.filter((p) => p.id !== action.id) }

    case 'duplicatePage': {
      const index = state.pages.findIndex((p) => p.id === action.id)
      const source = state.pages[index]
      if (!source) return state
      return {
        ...state,
        pages: state.pages.toSpliced(index + 1, 0, { ...source, id: action.newId }),
      }
    }

    case 'movePage': {
      const { from, to } = action
      const page = state.pages[from]
      if (!page || from === to || to < 0 || to >= state.pages.length) return state
      return { ...state, pages: state.pages.toSpliced(from, 1).toSpliced(to, 0, page) }
    }

    case 'removePages': {
      const ids = new Set(action.ids)
      const pages = state.pages.filter((p) => !ids.has(p.id))
      return pages.length === state.pages.length ? state : { ...state, pages }
    }

    case 'duplicatePages': {
      const copies = new Map(action.ids.map((id, i) => [id, action.newIds[i] ?? `${id}-copy`]))
      if (!state.pages.some((p) => copies.has(p.id))) return state
      return {
        ...state,
        pages: state.pages.flatMap((p) => {
          const newId = copies.get(p.id)
          return newId ? [p, { ...p, id: newId }] : [p]
        }),
      }
    }

    case 'movePages': {
      const ids = new Set(action.ids)
      const block = state.pages.filter((p) => ids.has(p.id))
      if (block.length === 0) return state
      const rest = state.pages.filter((p) => !ids.has(p.id))
      const pages = rest.toSpliced(clamp(action.at, 0, rest.length), 0, ...block)
      return pages.every((p, i) => p === state.pages[i]) ? state : { ...state, pages }
    }

    case 'shiftPages': {
      const ids = new Set(action.ids)
      const pages = [...state.pages]
      const last = pages.length - 1
      // Walk towards the move, so a run of selected pages moves together.
      for (let step = 0; step < last; step++) {
        const i = action.by < 0 ? step + 1 : last - step - 1
        const j = i + action.by
        const page = pages[i]
        const other = pages[j]
        if (page && other && ids.has(page.id) && !ids.has(other.id)) {
          pages[i] = other
          pages[j] = page
        }
      }
      return pages.every((p, i) => p === state.pages[i]) ? state : { ...state, pages }
    }

    case 'rotatePages': {
      const ids = new Set(action.ids)
      if (!state.pages.some((p) => ids.has(p.id))) return state
      return {
        ...state,
        pages: state.pages.map((p) =>
          ids.has(p.id) ? { ...p, turns: turn(p.turns, action.by) } : p,
        ),
      }
    }

    case 'rotatePage':
      return mapPage(state, action.id, (p) => ({ ...p, turns: turn(p.turns, action.by) }))

    case 'rotateAll':
      return {
        ...state,
        pages: state.pages.map((p) => ({ ...p, turns: turn(p.turns, action.by) })),
      }

    case 'transformPage':
      return mapPage(state, action.id, (p) => ({ ...p, ...cleanTransform(action.patch) }))

    case 'transformPages': {
      if (!action.patches.some(({ id }) => state.pages.some((p) => p.id === id))) return state
      const byId = new Map(action.patches.map(({ id, patch }) => [id, cleanTransform(patch)]))
      return {
        ...state,
        pages: state.pages.map((p) => {
          const patch = byId.get(p.id)
          return patch ? { ...p, ...patch } : p
        }),
      }
    }

    case 'interleavePages':
      return interleave(state, action.fronts, action.backs, action.backsReversed)

    case 'reversePages':
      return reverse(state, action.ids)

    case 'sortPages':
      return sort(state, action.by, action.ids)

    case 'resetPage':
      return mapPage(state, action.id, (p) => ({ ...p, ...DEFAULT_TRANSFORM }))

    case 'applyToAll': {
      const source = state.pages.find((p) => p.id === action.id)
      if (!source) return state
      const { turns, angle, scale, fit, filter } = source
      return {
        ...state,
        pages: state.pages.map((p) => ({ ...p, turns, angle, scale, fit, filter })),
      }
    }

    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...cleanSettings(action.patch) } }

    case 'clear':
      return { ...state, assets: {}, pages: [] }
  }
}
