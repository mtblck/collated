import { TimeoutError, withTimeout } from '../lib/timeout'
import { MAX_TIFF_PAGES } from '../core/tiff'
import { ImportError, tooManyPixels } from './errors'
import type { TiffPage, TiffRequest, TiffResponse } from './tiffProtocol'

/**
 * Talks to the TIFF worker (#113). One worker is kept for the session; one
 * that fails or stalls is terminated and the next file gets a fresh one.
 */
let worker: Worker | undefined
let queue: Promise<unknown> = Promise.resolve()

/** Per request: a page is a strip decode, seconds at most even on a slow phone. */
export const TIFF_TIMEOUT_MS = 60_000

const getWorker = () =>
  (worker ??= new Worker(new URL('./tiff.worker.ts', import.meta.url), {
    type: 'module',
    name: 'collated-tiff',
  }))

const discard = (w: Worker) => {
  w.terminate()
  if (worker === w) worker = undefined
}

/** The message for a failure the worker explained, or null for an unexpected one. */
const explain = (data: Extract<TiffResponse, { ok: false }>): ImportError | null => {
  if (data.tooLarge) return tooManyPixels(data.tooLarge.width, data.tooLarge.height)
  switch (data.reason) {
    case 'bigtiff':
      return new ImportError(
        'This is a BigTIFF file, which Collated can’t read. Save it as an ordinary TIFF, PNG or PDF.',
      )
    case 'too-many-pages':
      return new ImportError(
        `This TIFF has more than ${String(MAX_TIFF_PAGES)} pages; split it and add the parts.`,
      )
    case 'no-pages':
      return new ImportError('This TIFF has no pages.')
    case 'colour':
      return new ImportError(
        'This TIFF stores colour in a way Collated can’t read. Save it as PNG or JPEG.',
      )
    case 'damaged':
      return new ImportError('This TIFF couldn’t be read; it may be damaged.')
    default:
      return null
  }
}

const ask = <T extends TiffResponse & { ok: true }>(
  w: Worker,
  request: TiffRequest,
  transfer: Transferable[] = [],
): Promise<T> => {
  const answered = new Promise<T>((resolve, reject) => {
    w.onmessage = ({ data }: MessageEvent<TiffResponse>) => {
      if (data.ok) resolve(data as T)
      else reject(explain(data) ?? new Error(data.message))
    }
    w.onerror = (event) => {
      event.preventDefault()
      discard(w)
      reject(new Error(event.message || 'The TIFF decoder failed to start.'))
    }
    w.postMessage(request, transfer)
  })
  return withTimeout(answered, TIFF_TIMEOUT_MS, 'TIFF decode timed out', () => {
    discard(w)
  }).catch((error: unknown) => {
    if (error instanceof TimeoutError) {
      throw new ImportError('Reading this TIFF took too long, so it was stopped.')
    }
    throw error
  })
}

/**
 * Opens a TIFF and hands `withPages` its page count and a reader for each page.
 * One file at a time: the worker holds the open file until `withPages` is done.
 */
export const withTiff = async <R>(
  bytes: Uint8Array,
  withPages: (pages: number, read: (index: number) => Promise<TiffPage>) => Promise<R>,
): Promise<R> => {
  const run = async () => {
    const w = getWorker()
    // A copy: the caller keeps its bytes, the worker owns this one.
    const copy = bytes.slice().buffer
    const { pages } = await ask<Extract<TiffResponse, { type: 'open' }>>(
      w,
      { type: 'open', bytes: copy },
      [copy],
    )
    return withPages(pages, async (index) => {
      const answer = await ask<Extract<TiffResponse, { type: 'page' }>>(w, { type: 'page', index })
      return answer.page
    })
  }
  const result = queue.then(run)
  queue = result.catch(() => undefined)
  return result
}
