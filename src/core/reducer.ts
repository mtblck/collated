import { PAGE_MAX, PAGE_MIN } from './limits'
import { interleave, reverse, sort, type SortKey } from './order'
import { isConvex, type Point, type Quad } from './perspective'
import { cleanRedactions } from './redact'
import type {
  Asset,
  DocState,
  Page,
  PageTransform,
  QuarterTurns,
  Settings,
  SheetKind,
  Slot,
} from './model'
import { ANGLE_LIMIT, DEFAULT_TRANSFORM, SCALE_MAX, SCALE_MIN, SHEET_CAPACITY } from './model'
import { picturesOf } from './model'

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
  /*
   * Several pictures on one page (#76). `combinePages` puts the selected
   * pages' pictures, in document order, onto as many sheets of `kind` as
   * they fill (one id each from `newIds`), where the first of them was.
   * `splitPage` turns a combined page back into one page per picture.
   */
  | { type: 'combinePages'; ids: string[]; kind: SheetKind; newIds: string[] }
  | { type: 'splitPage'; id: string; newIds: string[] }
  | { type: 'setSheetKind'; id: string; kind: SheetKind }
  | { type: 'transformPage'; id: string; patch: Partial<PageTransform> }
  /**
   * Several pages at once, as one undo step (e.g. auto-straighten all). With
   * `slot`, only that picture of a combined page (auto-rotate reads each one).
   */
  | {
      type: 'transformPages'
      patches: { id: string; slot?: number; patch: Partial<PageTransform> }[]
    }
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
  if (out.redactions) out.redactions = cleanRedactions(out.redactions)
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

/**
 * A change to how a page looks. On a combined page it goes to each picture,
 * so rotating, filtering or resetting the page does that to all of them.
 */
type Look = <T extends Slot>(picture: T) => T

const restyle = (page: Page, fn: Look): Page =>
  page.sheet ? { ...page, sheet: { ...page.sheet, slots: page.sheet.slots.map(fn) } } : fn(page)

const mapPage = (state: DocState, id: string, fn: Look): DocState => ({
  ...state,
  pages: state.pages.map((p) => (p.id === id ? restyle(p, fn) : p)),
})

/** A picture as a slot: a page's look and content, without its id or sheet. */
const slotOf = ({
  assetId,
  turns,
  angle,
  scale,
  fit,
  filter,
  corners,
  redactions,
}: Slot): Slot => ({
  assetId,
  turns,
  angle,
  scale,
  fit,
  filter,
  corners,
  ...(redactions?.length ? { redactions } : {}),
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
          ids.has(p.id) ? restyle(p, (s) => ({ ...s, turns: turn(s.turns, action.by) })) : p,
        ),
      }
    }

    case 'rotatePage':
      return mapPage(state, action.id, (p) => ({ ...p, turns: turn(p.turns, action.by) }))

    case 'rotateAll':
      return {
        ...state,
        pages: state.pages.map((p) =>
          restyle(p, (s) => ({ ...s, turns: turn(s.turns, action.by) })),
        ),
      }

    case 'transformPage':
      return mapPage(state, action.id, (p) => ({ ...p, ...cleanTransform(action.patch) }))

    case 'transformPages': {
      if (!action.patches.some(({ id }) => state.pages.some((p) => p.id === id))) return state
      const byId = new Map<string, { slot: number | undefined; patch: Partial<PageTransform> }[]>()
      for (const { id, slot, patch } of action.patches) {
        byId.set(id, [...(byId.get(id) ?? []), { slot, patch: cleanTransform(patch) }])
      }
      return {
        ...state,
        pages: state.pages.map((p) => {
          const patches = byId.get(p.id)
          if (!patches) return p
          let page = p
          for (const { slot, patch } of patches) {
            // PDF pictures on a combined page keep their vector content.
            const { filter: _filter, ...vector } = patch
            const look = <T extends Slot>(s: T): T => ({
              ...s,
              ...(p.sheet && state.assets[s.assetId]?.format === 'pdf' ? vector : patch),
            })
            page =
              slot !== undefined && page.sheet
                ? {
                    ...page,
                    sheet: {
                      ...page.sheet,
                      slots: page.sheet.slots.map((s, i) => (i === slot ? look(s) : s)),
                    },
                  }
                : restyle(page, look)
          }
          return page
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
        pages: state.pages.map((p) =>
          restyle(p, (s) => ({ ...s, turns, angle, scale, fit, filter })),
        ),
      }
    }

    case 'combinePages': {
      const ids = new Set(action.ids)
      const chosen = state.pages.filter((p) => ids.has(p.id))
      const pictures = chosen.flatMap((p) => picturesOf(p).map(slotOf))
      if (pictures.length < 2) return state
      const per = SHEET_CAPACITY[action.kind]
      const sheets: Page[] = []
      for (let i = 0; i < pictures.length; i += per) {
        const slots = pictures.slice(i, i + per)
        const first = slots[0]
        if (!first) break
        sheets.push({
          id:
            action.newIds[sheets.length] ?? `${chosen[0]?.id ?? 'sheet'}-${String(sheets.length)}`,
          assetId: first.assetId,
          ...DEFAULT_TRANSFORM,
          sheet: { kind: action.kind, slots },
        })
      }
      // Where the first of them was: no chosen page comes before it.
      const at = state.pages.findIndex((p) => ids.has(p.id))
      const rest = state.pages.filter((p) => !ids.has(p.id))
      return { ...state, pages: rest.toSpliced(at, 0, ...sheets) }
    }

    case 'splitPage': {
      const index = state.pages.findIndex((p) => p.id === action.id)
      const sheet = state.pages[index]?.sheet
      if (!sheet) return state
      const pages = sheet.slots.map((slot, i): Page => ({
        ...slot,
        id: action.newIds[i] ?? `${action.id}-${String(i)}`,
      }))
      return { ...state, pages: state.pages.toSpliced(index, 1, ...pages) }
    }

    case 'setSheetKind': {
      const page = state.pages.find((p) => p.id === action.id)
      const sheet = page?.sheet
      if (!sheet || sheet.kind === action.kind) return state
      if (sheet.slots.length > SHEET_CAPACITY[action.kind]) return state
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.id ? { ...p, sheet: { ...sheet, kind: action.kind } } : p,
        ),
      }
    }

    case 'setSettings':
      return { ...state, settings: { ...state.settings, ...cleanSettings(action.patch) } }

    case 'clear':
      return { ...state, assets: {}, pages: [] }
  }
}
