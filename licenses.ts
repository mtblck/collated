import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Ships the licence texts the bundled libraries require with the built site,
 * under `<base>licenses/`, so the deployed copy carries them and
 * THIRD-PARTY-NOTICES.md can link to them. The texts are copied from the
 * installed packages, so they're the upstream files, not retyped.
 */
const require = createRequire(import.meta.url)
/** Vendored: the C libraries compiled into tesseract.js-core (see its README). */
const vendored = (file: string) => join(import.meta.dirname, 'licenses', file)

export const TESSERACT_CORE_LICENSES = [
  'README.md',
  'leptonica.txt',
  'libtiff.txt',
  'libpng.txt',
  'zlib-README.txt',
  'libjpeg-README.txt',
  'libwebp.txt',
  'libwebp-PATENTS.txt',
  'giflib.txt',
  'openlibm.txt',
] as const
const fromPackage = (pkg: string, file: string) =>
  join(dirname(require.resolve(`${pkg}/package.json`)), file)

export const LICENSE_FILES: Record<string, string> = {
  // libheif's own licence file: LGPL-3.0 followed by the GPL-3.0 it
  // incorporates. libde265, compiled into the same .wasm, is LGPL-3.0 too.
  'LGPL-3.0-and-GPL-3.0.txt': fromPackage('libheif-js', 'libheif-wasm/LICENSE'),
  'Apache-2.0.txt': fromPackage('tesseract.js-core', 'LICENSE'),
  'idb-keyval-NOTICE.txt': fromPackage('idb-keyval', 'LICENCE'),
  'tesseract-worker-NOTICES.txt': fromPackage('tesseract.js', 'dist/worker.min.js.LICENSE.txt'),
  'THIRD-PARTY-NOTICES.md': join(import.meta.dirname, 'THIRD-PARTY-NOTICES.md'),
  ...Object.fromEntries(
    TESSERACT_CORE_LICENSES.map((name) => [
      `tesseract-core/${name}`,
      vendored(`tesseract-core/${name}`),
    ]),
  ),
}

export const licenseFiles = (): Plugin => ({
  name: 'collated-licenses',
  apply: 'build',
  generateBundle() {
    for (const [name, file] of Object.entries(LICENSE_FILES)) {
      this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: readFileSync(file) })
    }
  },
})
