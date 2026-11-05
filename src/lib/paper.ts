import type { Asset } from '../core/model'
import type { PaperGuess } from '../core/paper'
import type { Quad } from '../core/perspective'
import { assetStore } from '../import/assetStore'
import { withTimeout } from './timeout'
import type { PaperRequest, PaperResponse } from './paperProtocol'

/**
 * Suggests a page's crop corners: the paper's corners in its thumbnail,
 * found in a worker (lib/paper.worker.ts). One worker is kept for the
 * session; one that fails or stalls is dropped and the next call starts
 * another. Null when there's no clear sheet, for PDF pages (which can't be
 * cropped), and when the search fails: a suggestion is never worth an error.
 */
let worker: Worker | undefined
let nextId = 0
const waiting = new Map<number, (response: PaperResponse) => void>()

/** A page's search takes well under a second; this one is stuck. */
export const PAPER_TIMEOUT_MS = 10_000

const getWorker = () => {
  if (worker) return worker
  const w = new Worker(new URL('./paper.worker.ts', import.meta.url), {
    type: 'module',
    name: 'collated-paper',
  })
  w.onmessage = ({ data }: MessageEvent<PaperResponse>) => {
    waiting.get(data.id)?.(data)
    waiting.delete(data.id)
  }
  w.onerror = (event) => {
    event.preventDefault()
    discard(w)
  }
  worker = w
  return w
}

/** Stops the worker and settles everything it owed with "nothing found". */
const discard = (w: Worker) => {
  w.terminate()
  if (worker !== w) return
  worker = undefined
  for (const [id, settle] of waiting) settle({ id, ok: true, guess: null })
  waiting.clear()
}

/** Asks the worker; null when it fails, stalls or finds nothing clear. */
const ask = async (thumb: Blob | ImageBitmap): Promise<PaperGuess | null> => {
  const w = getWorker()
  const id = (nextId += 1)
  const response = new Promise<PaperResponse>((resolve) => {
    waiting.set(id, resolve)
    const request: PaperRequest = { id, thumb }
    w.postMessage(request, thumb instanceof Blob ? [] : [thumb])
  })
  try {
    const result = await withTimeout(
      response,
      PAPER_TIMEOUT_MS,
      'Finding the paper timed out',
      () => {
        discard(w)
      },
    )
    return result.ok ? result.guess : null
  } catch {
    return null
  }
}

export const paperOf = async (asset: Pick<Asset, 'thumbUrl' | 'format'>): Promise<Quad | null> => {
  if (asset.format === 'pdf') return null
  const thumb = assetStore.thumbBlob(asset.thumbUrl)
  if (!thumb) return null
  return (await ask(thumb))?.corners ?? null
}

/**
 * The paper in a camera frame (#118), already downscaled (the detector works
 * at 320 px anyway, and a small bitmap is cheap to hand over). The bitmap is
 * transferred to the worker, which closes it; it can't be used after the call.
 */
export const paperInFrame = (frame: ImageBitmap): Promise<PaperGuess | null> => ask(frame)
