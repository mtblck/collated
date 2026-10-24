import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'
import type { SwManifest } from './src/sw/routes'

/**
 * Builds /sw.js (#73, ADR 0007): `src/sw/sw.ts` bundled on its own into one
 * classic script (no chunks shared with the app, which a service worker
 * couldn't import), with this build's file lists written in.
 */
const ENTRY = join(import.meta.dirname, 'src', 'sw', 'sw.ts')
const PLACEHOLDER = '__SW_MANIFEST__'

/** Fetched on first use rather than on install: megabytes most visits never need. */
const ON_DEMAND = [/^ocr\//, /^assets\/heic\.worker-/, /^assets\/libheif-/]
/** Neither: source maps, licence texts (linked, never needed offline), robots.txt. */
const SKIP = [/\.map$/, /^licenses\//, /^robots\.txt$/, /^sw\.js$/]

export interface BuiltFile {
  /** Path in dist, e.g. `assets/index-abc.js` or `docs/keyboard/index.html`. */
  name: string
  bytes: Uint8Array | string
}

const hash = (files: readonly BuiltFile[]) => {
  const h = createHash('sha256')
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    h.update(file.name).update('\0').update(file.bytes).update('\0')
  }
  return h.digest('hex').slice(0, 16)
}

/** The URL a file is served at: folders' index.html by the folder, as the server does. */
const urlOf = (name: string) => `/${name.replace(/(^|\/)index\.html$/, '$1')}`

/** Sorts a build's files into the service worker's two caches. */
export const planCaches = (files: readonly BuiltFile[]): SwManifest => {
  const kept = files.filter((f) => !SKIP.some((re) => re.test(f.name)))
  const onDemand = kept.filter((f) => ON_DEMAND.some((re) => re.test(f.name)))
  const shell = kept.filter((f) => !onDemand.includes(f))
  // A renamed chunk would silently move megabytes into every first visit.
  for (const re of ON_DEMAND) {
    if (!onDemand.some((f) => re.test(f.name))) {
      throw new Error(`service-worker: no built file matches ${String(re)}; update ON_DEMAND.`)
    }
  }
  if (!shell.some((f) => f.name === 'index.html')) throw new Error('service-worker: no index.html')
  return {
    version: hash(shell),
    shell: shell.map((f) => urlOf(f.name)).sort(),
    onDemand: onDemand.map((f) => urlOf(f.name)).sort(),
    onDemandVersion: hash(onDemand),
  }
}

/** Every file under `dir`, named by its path relative to it with forward slashes. */
const filesIn = (dir: string): BuiltFile[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name)
      return { name: relative(dir, path).split(sep).join('/'), bytes: readFileSync(path) }
    })

/** sw.ts as one script, with `manifest` in place of the placeholder. */
export const buildWorker = async (manifest: SwManifest) => {
  const { rolldown } = await import('rolldown')
  const bundle = await rolldown({ input: ENTRY, platform: 'browser', logLevel: 'warn' })
  try {
    const { output } = await bundle.generate({ format: 'iife', minify: true })
    const [chunk, ...rest] = output
    if (rest.some((o) => o.type === 'chunk')) {
      throw new Error('service-worker: sw.ts must build to a single script')
    }
    const parts = chunk.code.split(PLACEHOLDER)
    if (parts.length !== 2) {
      throw new Error(`service-worker: expected ${PLACEHOLDER} once in sw.js`)
    }
    return parts.join(JSON.stringify(manifest))
  } finally {
    await bundle.close()
  }
}

export const serviceWorker = (): Plugin => {
  let publicDir = ''
  return {
    name: 'collated-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle: {
      // After the docs pages, OCR files and licences are emitted.
      order: 'post',
      async handler(_options, bundle) {
        const built = Object.values(bundle).map((file) => ({
          name: file.fileName,
          bytes: file.type === 'chunk' ? file.code : file.source,
        }))
        const manifest = planCaches([...built, ...(publicDir ? filesIn(publicDir) : [])])
        this.emitFile({ type: 'asset', fileName: 'sw.js', source: await buildWorker(manifest) })
      },
    },
  }
}
