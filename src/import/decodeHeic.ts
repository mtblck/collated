import { TimeoutError, withTimeout } from '../lib/timeout'
import { ImportError, tooManyPixels } from './errors'
import type { HeicRequest, HeicResponse } from './heicProtocol'

/**
 * Decodes a HEIC file to an upright ImageBitmap in the HEIC worker. One
 * worker is kept for the session so libheif compiles once, not per photo —
 * unless it fails or stalls, when it's terminated and the next file gets a
 * fresh one.
 */
let worker: Worker | undefined
let queue: Promise<unknown> = Promise.resolve()

/**
 * Generous: the first decode also downloads and compiles libheif (~1.4 MB),
 * and a 48 MP photo on a slow phone takes seconds. A decode that runs this
 * long is stuck, and would otherwise hold up every HEIC file after it.
 */
export const HEIC_TIMEOUT_MS = 120_000

const getWorker = () =>
  (worker ??= new Worker(new URL('./heic.worker.ts', import.meta.url), {
    type: 'module',
    name: 'collated-heic',
  }))

/** Stops the worker (if it's still the current one) so the next run starts clean. */
const discard = (w: Worker) => {
  w.terminate()
  if (worker === w) worker = undefined
}

const run = (bytes: ArrayBuffer): Promise<ImageBitmap> => {
  const w = getWorker()
  const decoded = new Promise<ImageBitmap>((resolve, reject) => {
    w.onmessage = ({ data }: MessageEvent<HeicResponse>) => {
      if (!data.ok) {
        const tooLarge = data.tooLarge && tooManyPixels(data.tooLarge.width, data.tooLarge.height)
        reject(tooLarge ?? new Error(data.message))
        return
      }
      // The pixels were transferred to us, so they can be used as they are.
      createImageBitmap(new ImageData(data.pixels, data.width, data.height)).then(resolve, reject)
    }
    w.onerror = (event) => {
      event.preventDefault()
      discard(w)
      reject(new Error(event.message || 'The HEIC decoder failed to start.'))
    }
    const request: HeicRequest = { bytes }
    w.postMessage(request, [bytes])
  })
  return withTimeout(decoded, HEIC_TIMEOUT_MS, 'HEIC decode timed out', () => {
    discard(w)
  }).catch((error: unknown) => {
    if (error instanceof TimeoutError) {
      throw new ImportError(
        'Decoding this HEIC photo took too long, so it was stopped. Try exporting it as JPEG.',
      )
    }
    throw error
  })
}

/** Decodes one file at a time: libheif in one worker handles one image at once. */
export const decodeHeic = async (file: Blob): Promise<ImageBitmap> => {
  const bytes = await file.arrayBuffer()
  const result = queue.then(() => run(bytes))
  queue = result.catch(() => undefined)
  return result
}
