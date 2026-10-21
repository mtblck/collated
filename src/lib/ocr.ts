import type { Worker as TesseractWorker } from 'tesseract.js'
import type { OcrWord } from '../core/textLayer'
import { TimeoutError, withTimeout } from './timeout'

/**
 * OCR with tesseract.js, entirely on this device. Everything it loads is
 * self-hosted under `ocr/` (see ocr-assets.ts): the worker script, one engine
 * variant (~1 MB gzipped, by SIMD support) and English data (~3 MB), fetched
 * the first time and cached by the browser. `workerBlobURL: false` keeps the
 * worker a real file, as `worker-src 'self'` requires.
 */
const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href

/**
 * Starting includes the first download (~4 MB), so it gets longer than a
 * page. A page at OCR size takes seconds; minutes means the engine is stuck.
 */
export const OCR_START_TIMEOUT_MS = 180_000
export const OCR_PAGE_TIMEOUT_MS = 120_000

let worker: Promise<TesseractWorker> | undefined
/** The started worker behind `worker`, once it has started. */
let ready: TesseractWorker | undefined

/**
 * One worker for the session. If starting it fails or a page stalls, it's
 * terminated and forgotten, so the next attempt starts fresh rather than
 * reusing a broken worker forever.
 */
const getWorker = () => {
  if (worker) return worker
  const starting = (async () => {
    const { createWorker, OEM } = await import('tesseract.js')
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: `${base()}core`,
      langPath: `${base()}lang`,
      workerBlobURL: false,
      gzip: true,
    })
  })()
  const current: Promise<TesseractWorker> = withTimeout(
    starting,
    OCR_START_TIMEOUT_MS,
    'Text recognition took too long to start, so it was stopped. Try again.',
    () => {
      // If it does start after all, don't leave it running.
      starting.then((w) => w.terminate()).catch(() => undefined)
    },
  ).then(
    (w) => {
      if (worker === current) ready = w
      return w
    },
    (error: unknown) => {
      if (worker === current) worker = undefined
      throw error instanceof TimeoutError
        ? error
        : new Error('Text recognition couldn’t start. Check the connection and try again.', {
            cause: error,
          })
    },
  )
  worker = current
  return current
}

/** Terminates a worker and, if it's the cached one, forgets it. */
const reset = (w: TesseractWorker) => {
  if (ready === w) {
    worker = undefined
    ready = undefined
  }
  w.terminate().catch(() => undefined)
}

/** Words below this confidence (0–100) are more likely noise than text. */
const MIN_CONFIDENCE = 40

/**
 * Recognises the words in an image of `width × height` pixels and returns
 * them as fractions of the image, with each word's baseline from its line.
 */
export const recognizeWords = async (
  image: Blob,
  width: number,
  height: number,
): Promise<OcrWord[]> => {
  const w = await getWorker()
  let data
  try {
    ;({ data } = await withTimeout(
      w.recognize(image, {}, { blocks: true }),
      OCR_PAGE_TIMEOUT_MS,
      'Reading the text on a page took too long, so it was stopped. Try again, or turn off searchable text.',
      () => {
        reset(w)
      },
    ))
  } catch (error) {
    // A failed recognise may have left the engine in a bad state.
    reset(w)
    throw error
  }
  const words: OcrWord[] = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = line.baseline
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text || word.confidence < MIN_CONFIDENCE) continue
          const { x0, y0, x1, y1 } = word.bbox
          // Baseline height under the word's start, from the line's baseline.
          const t = bx1 === bx0 ? 0 : (x0 - bx0) / (bx1 - bx0)
          const baseline = by0 + (by1 - by0) * t
          words.push({
            text,
            x0: x0 / width,
            y0: y0 / height,
            x1: x1 / width,
            y1: y1 / height,
            baseline: Math.min(y1, Math.max(y0, baseline)) / height,
          })
        }
      }
    }
  }
  return words
}
