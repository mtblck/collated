import { useCallback, useMemo, useReducer } from 'react'
import type { DocState, Settings } from '../core/model'
import { canRedo, canUndo, initHistory, withHistory, type History } from '../core/history'
import { docReducer, type Action } from '../core/reducer'

const historyReducer = withHistory(docReducer)

/** The document plus undo/redo. `gesture` groups a continuous drag into one undo step. */
export const useDocument = (initialSettings: () => Settings) => {
  const [history, send] = useReducer(historyReducer, undefined, () =>
    initHistory<DocState>({ settings: initialSettings(), assets: {}, pages: [] }),
  )

  const act = useCallback((action: Action, gesture?: string) => {
    send({ type: 'do', action, ...(gesture ? { coalesce: gesture } : {}) })
  }, [])
  const undo = useCallback(() => {
    send({ type: 'undo' })
  }, [])
  const redo = useCallback(() => {
    send({ type: 'redo' })
  }, [])
  const endGesture = useCallback(() => {
    send({ type: 'commit' })
  }, [])
  /** An empty document with `settings` and no undo history (Start over). */
  const reset = useCallback((settings: Settings) => {
    send({ type: 'reset', present: { settings, assets: {}, pages: [] } })
  }, [])
  /** A saved document, undo history and all (restored after a reload). */
  const restore = useCallback((saved: History<DocState>) => {
    send({ type: 'restore', history: saved })
  }, [])

  return useMemo(
    () => ({
      doc: history.present,
      /** The whole history, for keeping it on this device. */
      history,
      /** The states undo and redo would go to, for describing them. */
      previous: history.past.at(-1),
      next: history.future[0],
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      act,
      undo,
      redo,
      endGesture,
      reset,
      restore,
    }),
    [history, act, undo, redo, endGesture, reset, restore],
  )
}
