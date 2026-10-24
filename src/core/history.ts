/**
 * Undo/redo around any reducer.
 *
 * `coalesce` lets a continuous gesture (dragging a slider) collapse into one
 * undo step: consecutive actions with the same key replace the present instead
 * of pushing a new entry, so one undo returns to where the drag started.
 */

export interface History<S> {
  past: S[]
  present: S
  future: S[]
  /** Key of the last coalescing action, if the last change was one. */
  lastKey: string | null
}

export type HistoryAction<A, S = unknown> =
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'do'; action: A; coalesce?: string }
  /** Ends any coalescing run, so the next change starts a fresh undo step. */
  | { type: 'commit' }
  /** Replaces everything, history included: nothing to undo back to. */
  | { type: 'reset'; present: S }
  /** Puts back a whole saved history (a document kept on this device). */
  | { type: 'restore'; history: History<S> }

export const HISTORY_LIMIT = 100

export const initHistory = <S>(present: S): History<S> => ({
  past: [],
  present,
  future: [],
  lastKey: null,
})

export const withHistory =
  <S, A>(reducer: (state: S, action: A) => S) =>
  (history: History<S>, action: HistoryAction<A, S>): History<S> => {
    switch (action.type) {
      case 'undo': {
        const previous = history.past.at(-1)
        if (previous === undefined) return history
        return {
          past: history.past.slice(0, -1),
          present: previous,
          future: [history.present, ...history.future],
          lastKey: null,
        }
      }
      case 'redo': {
        const [next, ...future] = history.future
        if (next === undefined) return history
        return { past: [...history.past, history.present], present: next, future, lastKey: null }
      }
      case 'reset':
        return initHistory(action.present)
      case 'restore':
        return { ...action.history, lastKey: null }
      case 'commit':
        return history.lastKey === null ? history : { ...history, lastKey: null }
      case 'do': {
        const present = reducer(history.present, action.action)
        if (present === history.present) return history
        const key = action.coalesce ?? null
        if (key !== null && key === history.lastKey) {
          return { ...history, present, future: [] }
        }
        return {
          past: [...history.past, history.present].slice(-HISTORY_LIMIT),
          present,
          future: [],
          lastKey: key,
        }
      }
    }
  }

export const canUndo = (history: History<unknown>) => history.past.length > 0
export const canRedo = (history: History<unknown>) => history.future.length > 0
