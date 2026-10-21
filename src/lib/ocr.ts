import type { Worker as TesseractWorker } from 'tesseract.js'
import type { OcrWord } from '../core/textLayer'

/**
 * OCR with tesseract.js, entirely on this device. Everything it loads is
 * self-hosted under `ocr/` (see ocr-assets.ts): the worker script, one engine
 * variant (~1 MB gzipped, by SIMD support) and English data (~3 MB), fetched
 * the first time and cached by the browser. `workerBlobURL: false` keeps the
 * worker a real file, as `worker-src 'self'` requires.
 */
const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href

let worker: Promise<TesseractWorker> | undefined

const getWorker = () =>
  (worker ??= (async () => {
    const { createWorker, OEM } = await import('tesseract.js')
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base()}worker.min.js`,
      corePath: `${base()}core`,
      langPath: `${base()}lang`,
      workerBlobURL: false,
      gzip: true,
    })
  })())

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
  const { data } = await w.recognize(image, {}, { blocks: true })
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
