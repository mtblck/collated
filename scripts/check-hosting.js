/**
 * Guards the hosting config that serving Collated from its own origin
 * (collatedpdf.com, from the root) depends on. Each check is a shape that has broken a sibling tool before, and
 * every one of them fails quietly in production: the page still loads, so the
 * config *looks* fine.
 *
 * Runs as the first step of `npm run build`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = '/'
/** Where Collated used to live, under mattblack.space; links to it must keep working. */
const OLD = '/tools/collated'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(join(root, file), 'utf8')
// An alternative vercel.json can be passed for the mutation tests.
const config = JSON.parse(
  process.argv[2] ? readFileSync(process.argv[2], 'utf8') : read('vercel.json'),
)
const problems = []

// 1. Built for the root of its own origin.
const vite = read('vite.config.ts')
if (!vite.includes("const BASE = '/'")) problems.push(`vite.config.ts must set base to ${BASE}.`)
if (!vite.includes("outDir: 'dist',")) problems.push('vite.config.ts must build to dist.')
if (config.outputDirectory !== 'dist') problems.push('vercel.json outputDirectory must be "dist".')

// 2. App fallback and trailing-slash redirect. The fallback serves the app
//    for paths without a file extension only: a missing file (an asset from
//    an older build, asked for by a tab opened before a deploy) must 404, not
//    come back as the app's HTML under the assets' immutable caching, which
//    a module worker can't run ("The PDF export failed to start", #42).
const FALLBACK_SOURCE = `${BASE}((?:[^/]*/)*[^./]*)`
const rewrites = config.rewrites ?? []
const fallback = rewrites.find((r) => r.source === FALLBACK_SOURCE)
if (fallback?.destination !== `${BASE}index.html`) {
  problems.push(`Missing rewrite ${FALLBACK_SOURCE} -> ${BASE}index.html.`)
}
if (rewrites.some((r) => r !== fallback && r.destination === `${BASE}index.html`)) {
  problems.push(
    'Only the extensionless fallback may rewrite to index.html (missing files must 404).',
  )
}
// The old address keeps working: every path under it goes to the same path
// here. Absolute, because mattblack.space proxies that path to this project:
// a relative Location would land back on the portfolio.
const ORIGIN = 'https://collatedpdf.com'
const redirects = config.redirects ?? []
if (
  !redirects.some((r) => r.source === OLD && r.destination === `${ORIGIN}/` && r.permanent) ||
  !redirects.some(
    (r) => r.source === `${OLD}/:path*` && r.destination === `${ORIGIN}/:path*` && r.permanent,
  )
) {
  problems.push(`Missing permanent redirects ${OLD}(/:path*) -> ${ORIGIN}/(:path*).`)
}
// Docs pages are folders; a URL typed without the slash would otherwise get
// the app from the fallback.
if (
  !(config.redirects ?? []).some(
    (r) =>
      r.source === `${BASE}:page(docs|docs/[^/.]+|privacy|terms)` &&
      r.destination === `${BASE}:page/`,
  )
) {
  problems.push('Missing redirect adding the slash to docs, privacy and terms URLs.')
}
for (const key of ['cleanUrls', 'trailingSlash', 'routes']) {
  if (key in config) problems.push(`"${key}" is set; it has silently disabled rewrites before.`)
}

// 3. The tool owns its security headers, and the CSP is pinned exactly:
//    every directive at its intended value and no others (a directive added
//    later could only widen what default-src allows). Tightening one means
//    changing it here too, on purpose.
const block = (config.headers ?? []).find((b) => b.source === `${BASE}(.*)`)
// Vercel applies every block whose source matches, so another block could
// override or add to these. Other blocks may only set caching.
for (const other of config.headers ?? []) {
  if (other === block) continue
  for (const { key } of other.headers) {
    if (key.toLowerCase() !== 'cache-control') {
      problems.push(
        `Header block ${other.source} sets ${key}; security headers belong only in ${BASE}(.*).`,
      )
    }
  }
}
const header = (key) => block?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value
const POLICY = {
  'default-src': "'self'",
  // 'wasm-unsafe-eval' permits compiling WebAssembly and nothing else (not
  // eval of strings). Two decoders need it: libheif for HEIC photos and
  // tesseract.js-core for OCR. 'unsafe-eval', 'unsafe-inline', hashes, hosts
  // or blob: would all widen it.
  'script-src': "'self' 'wasm-unsafe-eval'",
  // The PDF export, HEIC decoder, OCR and pdf.js all run in workers from our
  // own origin. Never blob: (code built in the page could run as a worker).
  'worker-src': "'self'",
  // Inline style attributes (dnd-kit transforms, preview geometry).
  'style-src': "'self' 'unsafe-inline'",
  'font-src': "'self'",
  // Thumbnails are blob: object URLs.
  'img-src': "'self' blob: data:",
  // The app talks to nobody: wasm, OCR data and pdf.js are fetched from here.
  'connect-src': "'self'",
  'manifest-src': "'self'",
  'object-src': "'none'",
  'frame-ancestors': "'none'",
  'base-uri': "'self'",
  'form-action': "'none'",
}
const csp = header('Content-Security-Policy') ?? ''
if (!csp) problems.push(`No Content-Security-Policy header for ${BASE}(.*).`)
else {
  const seen = new Map()
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/)
    if (!name) continue
    if (seen.has(name)) problems.push(`CSP ${name} appears twice (browsers use the first).`)
    else seen.set(name, values.join(' '))
  }
  for (const [name, want] of Object.entries(POLICY)) {
    const got = seen.get(name)
    if (got === undefined) problems.push(`CSP is missing ${name} ${want}.`)
    else if (got !== want) problems.push(`CSP ${name} must be exactly "${want}" (is "${got}").`)
  }
  for (const name of seen.keys()) {
    if (!(name in POLICY)) problems.push(`CSP has an unexpected directive ${name}.`)
  }
}
const exact = (key, want) => {
  const got = header(key)
  if (got !== want) problems.push(`${key} must be "${want}" (is ${got ? `"${got}"` : 'missing'}).`)
}
exact('X-Content-Type-Options', 'nosniff')
exact('X-Frame-Options', 'DENY')
exact('Cross-Origin-Opener-Policy', 'same-origin')
const referrer = header('Referrer-Policy')
if (
  !['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes(
    referrer,
  )
) {
  problems.push(`Referrer-Policy must be set to a strict policy (is ${referrer ?? 'missing'}).`)
}
const hsts = /max-age=(\d+)/.exec(header('Strict-Transport-Security') ?? '')
if (!hsts || Number(hsts[1]) < 31_536_000) {
  problems.push('Strict-Transport-Security must be set with max-age of at least a year.')
}
const permissions = header('Permissions-Policy') ?? ''
for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
  if (!permissions.includes(feature)) problems.push(`Permissions-Policy must include ${feature}.`)
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
