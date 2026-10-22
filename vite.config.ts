/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { docsSite } from './docs-site'
import { licenseFiles } from './licenses'
import { ocrAssets } from './ocr-assets'

/** Collated has its own origin (collatedpdf.com, #25): served from the root. */
const BASE = '/'

interface VercelHeaderBlock {
  source: string
  headers: { key: string; value: string }[]
}

// `vite preview` serves the same security headers as production (read from
// vercel.json), so a CSP regression shows up locally and in the verify script
// rather than only after deploying.
const productionHeaders = Object.fromEntries(
  (
    JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
      headers: VercelHeaderBlock[]
    }
  ).headers
    .filter((block) => block.source === '/(.*)')
    .flatMap((block) => block.headers)
    .map((h) => [h.key, h.value]),
)

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss(), ocrAssets(BASE), licenseFiles(), docsSite(BASE)],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // The export worker carries pdf-lib (~570 kB, ~200 kB gzip) and loads only
    // on export; the main bundle is React + dnd-kit.
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  preview: { port: 4174, strictPort: true, headers: productionHeaders },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    css: false,
  },
})
