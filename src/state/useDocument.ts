import { useCallback, useMemo, useReducer } from 'react'
import type { DocState, Settings } from '../core/model'
import { canRedo, canUndo, initHistory, withHistory } from '../core/history'
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

  return useMemo(
    () => ({
      doc: history.present,
      canUndo: canUndo(history),
      canRedo: canRedo(history),
      act,
      undo,
      redo,
      endGesture,
    }),
    [history, act, undo, redo, endGesture],
  )
}
