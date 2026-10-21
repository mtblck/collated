/**
 * Guards the hosting config that serving under mattblack.space/tools/collated/
 * depends on. Each check is a shape that has broken a sibling tool before, and
 * every one of them fails quietly in production: the page still loads, so the
 * config *looks* fine.
 *
 * Runs as the first step of `npm run build`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SLUG = 'collated'
const BASE = `/tools/${SLUG}/`
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
const config = JSON.parse(read('vercel.json'))
const problems = []

// 1. Files live at the same path on the tool's own domain and behind the
//    portfolio proxy. Anything else and assets 404 through the rewrite.
const vite = read('vite.config.ts')
if (
  !vite.includes('const BASE = `/tools/${SLUG}/`') ||
  !vite.includes("export const SLUG = 'collated'")
) {
  problems.push(`vite.config.ts must set base to ${BASE}.`)
}
if (!vite.includes('outDir: `dist/tools/${SLUG}`')) {
  problems.push(`vite.config.ts must build to dist/tools/${SLUG} so paths match on both domains.`)
}
if (config.outputDirectory !== 'dist') problems.push('vercel.json outputDirectory must be "dist".')

// 2. SPA fallback and trailing-slash redirect.
const fallback = (config.rewrites ?? []).find((r) => r.source === `${BASE}(.*)`)
if (fallback?.destination !== `${BASE}index.html`) {
  problems.push(`Missing rewrite ${BASE}(.*) -> ${BASE}index.html.`)
}
if (
  !(config.redirects ?? []).some((r) => r.source === `/tools/${SLUG}` && r.destination === BASE)
) {
  problems.push(`Missing redirect /tools/${SLUG} -> ${BASE}.`)
}
for (const key of ['cleanUrls', 'trailingSlash', 'routes']) {
  if (key in config) problems.push(`"${key}" is set; it has silently disabled rewrites before.`)
}

// 3. The tool owns its CSP. The PDF export runs in a module worker, so
//    worker-src must allow 'self'; thumbnails are blob: URLs.
const block = (config.headers ?? []).find((b) => b.source === `${BASE}(.*)`)
const csp = block?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
const directive = (name) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? ''
if (!csp) problems.push(`No Content-Security-Policy header for ${BASE}(.*).`)
else {
  // 'self' plus, at most, 'wasm-unsafe-eval' — which permits compiling
  // WebAssembly (the HEIC decoder) and nothing else. 'unsafe-eval',
  // 'unsafe-inline', hashes, hosts or blob: would all widen it.
  const scriptSources = directive('script-src').split(/\s+/).slice(1)
  if (
    !scriptSources.includes("'self'") ||
    scriptSources.some((src) => src !== "'self'" && src !== "'wasm-unsafe-eval'")
  ) {
    problems.push(
      "script-src must be 'self', optionally with 'wasm-unsafe-eval', and nothing else.",
    )
  }
  if (directive('worker-src').includes('blob:')) {
    problems.push('worker-src must not allow blob: (code built in the page could run as a worker).')
  }
  if (!directive('worker-src').includes("'self'")) {
    problems.push("worker-src must include 'self' (the PDF export runs in a worker).")
  }
  if (!directive('img-src').includes('blob:')) {
    problems.push('img-src must include blob: (page thumbnails are object URLs).')
  }
  if (!directive('frame-ancestors').includes("'none'"))
    problems.push("frame-ancestors must be 'none'.")
}

// 4. No inline scripts: under script-src 'self' the browser refuses to run
//    them, and the theme script was once inline and never ran.
const html = read('index.html')
for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? []) {
  if (!/\ssrc=/.test(tag)) problems.push('index.html has an inline <script>; move it into public/.')
}
if (!html.includes(`src="${BASE}theme.js"`)) {
  problems.push(
    `index.html must load ${BASE}theme.js by absolute path (relative 404s on deep links).`,
  )
}

if (problems.length) {
  console.error(`hosting:check failed:\n  - ${problems.join('\n  - ')}`)
  process.exit(1)
}
console.log('hosting:check ok')
