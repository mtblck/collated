import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'
import { OCR_LANGUAGES } from './src/core/ocrLanguages'

/**
 * Self-hosts OCR's runtime files at fixed paths under `<base>ocr/`, because
 * tesseract.js looks them up by directory and the CSP only allows our own
 * origin. Each visitor downloads one engine variant (picked by the browser's
 * SIMD support) plus the data for the language they choose (#79), and only if
 * they switch OCR on;
 * Auto-rotate pages fetches a legacy variant and the orientation data.
 */
const require = createRequire(import.meta.url)
const resolve = (id: string) => require.resolve(id)

export const OCR_FILES: Record<string, string> = {
  'worker.min.js': resolve('tesseract.js/dist/worker.min.js'),
  'core/tesseract-core-relaxedsimd-lstm.wasm.js': resolve(
    'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  ),
  'core/tesseract-core-simd-lstm.wasm.js': resolve(
    'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  ),
  'core/tesseract-core-lstm.wasm.js': resolve('tesseract.js-core/tesseract-core-lstm.wasm.js'),
  // The legacy engine, for orientation detection (Auto-rotate pages) only.
  'core/tesseract-core-relaxedsimd.wasm.js': resolve(
    'tesseract.js-core/tesseract-core-relaxedsimd.wasm.js',
  ),
  'core/tesseract-core-simd.wasm.js': resolve('tesseract.js-core/tesseract-core-simd.wasm.js'),
  'core/tesseract-core.wasm.js': resolve('tesseract.js-core/tesseract-core.wasm.js'),
  // "best_int": the accurate model, quantised (2.9 MB vs 10.9 MB for "best" in English).
  ...Object.fromEntries(
    OCR_LANGUAGES.map(({ code }) => [
      `lang/${code}.traineddata.gz`,
      resolve(`@tesseract.js-data/${code}/4.0.0_best_int/${code}.traineddata.gz`),
    ]),
  ),
  // Orientation and script detection; only the legacy engine reads it.
  'lang/osd.traineddata.gz': resolve('@tesseract.js-data/osd/4.0.0_best_int/osd.traineddata.gz'),
}

export const ocrAssets = (base: string): Plugin => ({
  name: 'collated-ocr-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0] ?? ''
      const prefix = `${base}ocr/`
      const name = path.startsWith(prefix) ? path.slice(prefix.length) : ''
      // Own keys only: /ocr/__proto__ or /ocr/constructor must not resolve
      // to Object.prototype members.
      const file = Object.hasOwn(OCR_FILES, name) ? OCR_FILES[name] : undefined
      if (!file) {
        next()
        return
      }
      res.setHeader('Content-Type', file.endsWith('.gz') ? 'application/gzip' : 'text/javascript')
      res.end(readFileSync(file))
    })
  },
  generateBundle() {
    for (const [name, file] of Object.entries(OCR_FILES)) {
      this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) })
    }
  },
})
