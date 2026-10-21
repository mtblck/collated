import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

/**
 * Self-hosts OCR's runtime files at fixed paths under `<base>ocr/`, because
 * tesseract.js looks them up by directory and the CSP only allows our own
 * origin. Each visitor downloads one engine variant (picked by the browser's
 * SIMD support) plus the English data, and only if they switch OCR on.
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
  // "best_int": the accurate model, quantised (2.9 MB vs 10.9 MB for "best").
  'lang/eng.traineddata.gz': resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
}

export const ocrAssets = (base: string): Plugin => ({
  name: 'collated-ocr-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0] ?? ''
      const prefix = `${base}ocr/`
      const file = path.startsWith(prefix) ? OCR_FILES[path.slice(prefix.length)] : undefined
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
