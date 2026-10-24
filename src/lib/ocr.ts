import type * as Tesseract from 'tesseract.js'
import type { Worker as TesseractWorker } from 'tesseract.js'
import type { OcrLanguage } from '../core/ocrLanguages'
import type { OcrWord } from '../core/textLayer'
import { TimeoutError, withTimeout } from './timeout'

/**
 * OCR with tesseract.js, entirely on this device. Everything it loads is
 * self-hosted under `ocr/` (see ocr-assets.ts): the worker script, one engine
 * variant (~1 MB gzipped, by SIMD support) and the chosen language's data
 * (0.7–3.8 MB, see core/ocrLanguages.ts), fetched the first time and cached by
 * the browser. `workerBlobURL: false` keeps the
 * worker a real file, as `worker-src 'self'` requires.
 */
const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href

/**
 * Starting includes the first download (~4 MB), so it gets longer than a
 * page. A page at OCR size takes seconds; minutes means the engine is stuck.
 */
export const OCR_START_TIMEOUT_MS = 180_000
export const OCR_PAGE_TIMEOUT_MS = 120_000

interface Engine {
  /** The started worker, starting it the first time. */
  get: () => Promise<TesseractWorker>
  /** Terminates a worker and, if it's the cached one, forgets it. */
  reset: (w: TesseractWorker) => void
  /** Terminates the cached worker, once it has started, and forgets it. */
  close: () => void
}

/**
 * One worker per engine for the session. If starting it fails or a page
 * stalls, it's terminated and forgotten, so the next attempt starts fresh
 * rather than reusing a broken worker forever.
 */
const engine = (
  start: (tesseract: typeof Tesseract) => Promise<TesseractWorker>,
  messages: { slow: string; failed: string },
): Engine => {
  let worker: Promise<TesseractWorker> | undefined
  /** The started worker behind `worker`, once it has started. */
  let ready: TesseractWorker | undefined
  return {
    get: () => {
      if (worker) return worker
      const starting = import('tesseract.js').then(start)
      const current: Promise<TesseractWorker> = withTimeout(
        starting,
        OCR_START_TIMEOUT_MS,
        messages.slow,
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
          throw error instanceof TimeoutError ? error : new Error(messages.failed, { cause: error })
        },
      )
      worker = current
      return current
    },
    reset: (w) => {
      if (ready === w) {
        worker = undefined
        ready = undefined
      }
      w.terminate().catch(() => undefined)
    },
    close: () => {
      const closing = worker
      worker = undefined
      ready = undefined
      closing?.then((w) => w.terminate()).catch(() => undefined)
    },
  }
}

const paths = () => ({
  workerPath: `${base()}worker.min.js`,
  corePath: `${base()}core`,
  langPath: `${base()}lang`,
  workerBlobURL: false,
  gzip: true,
})

/**
 * One reader at a time, for the language last asked for: choosing another
 * terminates it and starts one with that language's data (the engine itself
 * is cached by then, so only the data downloads).
 */
let reading: { language: OcrLanguage; engine: Engine } | undefined

const readerFor = (language: OcrLanguage): Engine => {
  if (reading?.language === language) return reading.engine
  reading?.engine.close()
  const next = engine(({ createWorker, OEM }) => createWorker(language, OEM.LSTM_ONLY, paths()), {
    slow: 'Text recognition took too long to start, so it was stopped. Try again.',
    failed: 'Text recognition couldn’t start. Check the connection and try again.',
  })
  reading = { language, engine: next }
  return next
}

/**
 * Orientation detection (OSD) is Tesseract's legacy engine: its own core
 * variant (~1.8 MB gzipped, the LSTM-only one can't do it) and `osd` data
 * (4.3 MB), so it's a second worker, started only when asked.
 */
const orienter = engine(
  async ({ createWorker, OEM }) => {
    const w = await createWorker('osd', OEM.TESSERACT_ONLY, {
      ...paths(),
      legacyCore: true,
      legacyLang: true,
    })
    // OSD reports "Too few characters" and a missing dpi on the console for
    // every page without text; the answer (null) already says so.
    await w.setParameters({ debug_file: '/dev/null' })
    return w
  },
  {
    slow: 'Finding which way up the pages are took too long to start, so it was stopped. Try again.',
    failed:
      'Finding which way up the pages are couldn’t start. Check the connection and try again.',
  },
)

/** Runs one job on an engine's worker, replacing the worker if it fails or stalls. */
const run = async <T>(
  { get, reset }: Engine,
  job: (w: TesseractWorker) => Promise<T>,
  slow: string,
): Promise<T> => {
  const w = await get()
  try {
    return await withTimeout(job(w), OCR_PAGE_TIMEOUT_MS, slow, () => {
      reset(w)
    })
  } catch (error) {
    // A failed job may have left the engine in a bad state.
    reset(w)
    throw error
  }
}

/** Words below this confidence (0–100) are more likely noise than text. */
const MIN_CONFIDENCE = 40
/**
 * ...unless every character in them is at least this sure. Tesseract marks
 * down whole words it can't find in its word list, such as French and Italian
 * elisions with a typographic apostrophe ("l’élève" at 36, "all’università"
 * at 56), while still reading each letter of them at 92 or more.
 */
const SURE_SYMBOL = 90

const keep = (word: Tesseract.Word) =>
  word.confidence >= MIN_CONFIDENCE ||
  (word.symbols.length > 0 && word.symbols.every((s) => s.confidence >= SURE_SYMBOL))

/**
 * Recognises the words in an image of `width × height` pixels and returns
 * them as fractions of the image, with each word's baseline from its line.
 */
export const recognizeWords = async (
  image: Blob,
  width: number,
  height: number,
  language: OcrLanguage,
): Promise<OcrWord[]> => {
  const { data } = await run(
    readerFor(language),
    (w) => w.recognize(image, {}, { blocks: true }),
    'Reading the text on a page took too long, so it was stopped. Try again, or turn off searchable text.',
  )
  const words: OcrWord[] = []
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const { x0: bx0, y0: by0, x1: bx1, y1: by1 } = line.baseline
        for (const word of line.words) {
          const text = word.text.trim()
          if (!text || !keep(word)) continue
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

/**
 * Which way the text in an image runs, by Tesseract's orientation detection:
 * the clockwise degrees (0, 90, 180 or 270) that would turn it upright, and
 * how sure it is. Null when there's too little text to tell.
 */
export const detectOrientation = async (
  image: Blob,
): Promise<{ degrees: number; confidence: number } | null> => {
  const { data } = await run(
    orienter,
    (w) => w.detect(image),
    'Finding which way up a page is took too long, so it was stopped. Try again.',
  )
  const { orientation_degrees: degrees, orientation_confidence: confidence } = data
  return degrees === null || confidence === null ? null : { degrees, confidence }
}
