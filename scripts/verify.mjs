/**
 * End-to-end check against the production build, in a real browser, served
 * with the production headers from vercel.json (so the CSP is enforced).
 *
 * It drives the app the way a person would — import a mixed batch, reorder by
 * keyboard, rotate, straighten, undo, export — then opens the exported PDF and
 * checks it, and compares the on-screen preview with poppler's render of the
 * PDF pixel by pixel. Any console error, uncaught exception or CSP violation
 * fails the run.
 *
 *   npm run build && npm run verify
 *   CHROME_PATH=/path/to/chrome   use a specific Chromium
 *   SHOTS=dir                     where to save screenshots (default: shots)
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const fixtures = join(root, 'tests', 'fixtures')
const shots = join(root, process.env.SHOTS ?? 'shots')
mkdirSync(shots, { recursive: true })
const BASE = '/'
const PORT = Number(process.env.VERIFY_PORT ?? 4175)
const URL_ROOT = `http://localhost:${PORT}${BASE}`

if (!existsSync(join(dist, 'index.html'))) {
  console.error('No build found. Run `npm run build` first.')
  process.exit(1)
}

// --- A static server that behaves like Vercel for this project. -------------
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const headerBlock = vercel.headers.find((b) => b.source === `${BASE}(.*)`)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}
/** Set by step 28 to take the site off the network: every connection drops. */
let serverDown = false
const server = createServer((req, res) => {
  if (serverDown) {
    req.socket.destroy()
    return
  }
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  // As vercel.json: the old address under mattblack.space keeps working.
  if (path === '/tools/collated' || path.startsWith('/tools/collated/')) {
    res.writeHead(308, { Location: path.slice('/tools/collated'.length) || '/' }).end()
    return
  }
  // As vercel.json: docs URLs typed without their slash go to the page.
  if (/^\/(docs|docs\/[^/.]+|privacy|terms)$/.test(path)) {
    res.writeHead(308, { Location: `${path}/` }).end()
    return
  }
  let file = join(dist, path)
  // As vercel.json: a missing file 404s; only extensionless paths get the app.
  if (path.startsWith(BASE) && extname(path) && !existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }
  // A folder URL serves its index.html, as Vercel does (the docs pages).
  if (path.endsWith('/') && existsSync(join(file, 'index.html'))) file = join(file, 'index.html')
  if (!path.startsWith(BASE) || !existsSync(file) || !extname(file)) {
    file = join(dist, 'index.html') // app fallback
  }
  for (const h of headerBlock.headers) res.setHeader(h.key, h.value)
  res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
  res.end(readFileSync(file))
})
await new Promise((resolve) => server.listen(PORT, resolve))

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
)
const fails = []
const ok = (message) => console.log(`  ok  ${message}`)

/** Opens the toolbar's Page setup popover, runs `act` on it, and closes it. */
const pageSetup = async (p, act) => {
  await p.getByRole('button', { name: /^Page setup/ }).click()
  const panel = p.getByRole('dialog', { name: 'Page setup' })
  await panel.waitFor()
  await act(panel)
  await p.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
}
/** The toolbar's export button, which opens the export popover. */
const exportMenu = (p) => p.getByRole('button', { name: /, options$/ })
/** Opens the export popover and clicks Export at its foot. */
const exportNow = async (p) => {
  await exportMenu(p).click()
  await p
    .getByRole('dialog', { name: 'Export options' })
    .getByRole('button', { name: /^Export (locked )?PDF$/ })
    .click()
}
/** Sets the title in the Export options popover. */
const setTitle = async (p, title) => {
  await exportMenu(p).click()
  const panel = p.getByRole('dialog', { name: 'Export options' })
  await panel.getByLabel('Title & filename').fill(title)
  await p.keyboard.press('Escape')
  await panel.waitFor({ state: 'hidden' })
}
const check = (condition, message, detail = '') => {
  if (condition) ok(message)
  else fails.push(`${message}${detail ? `\n      ${detail}` : ''}`)
}

// --- Same-origin and worker-CSP guards. ------------------------------------
// The app promises it talks to nobody. Every request any page or worker in
// any context makes (Playwright reports worker requests on the context) must
// be to this server, or a data:/blob: URL; offenders are listed at the end.
// A request the CSP refuses never reaches the network, so these catch what a
// loosened policy would let through; CSP violations are caught separately.
const ORIGIN = new URL(URL_ROOT).origin
const offOrigin = new Set()
/**
 * Workers' securitypolicyviolation events can't be heard from the page, so a
 * listener is added inside each worker as it starts (its console.error then
 * reaches page.on('console') like the page's own). A violation in the first
 * moments of a worker, before the listener lands, can still slip by.
 */
const guard = (context) => {
  context.on('request', (request) => {
    const url = request.url()
    if (/^(data|blob):/.test(url)) return
    if (new URL(url).origin !== ORIGIN) offOrigin.add(`${request.resourceType()} ${url}`)
  })
  context.on('page', (page) => {
    page.on('worker', (worker) => {
      worker
        .evaluate(() => {
          self.addEventListener('securitypolicyviolation', (e) => {
            console.error(`CSP blocked in worker ${e.blockedURI} (${e.violatedDirective})`)
          })
        })
        .catch(() => undefined) // a worker that has already finished
    })
  })
}
const checkSameOrigin = () => {
  check(
    offOrigin.size === 0,
    'every request went to our own origin (pages and workers)',
    [...offOrigin].join('\n      '),
  )
}
// ---------------------------------------------------------------------------

let expectRevoked = false
const open = async (options = {}) => {
  const context = await browser.newContext({ acceptDownloads: true, ...options })
  return { context, page: await watch(context, await context.newPage()) }
}
/** Fails the run on any console error, uncaught exception or CSP violation in `page`. */
const watch = async (context, page) => {
  guard(context)
  page.on('console', (m) => {
    // A check that loads a revoked blob: URL on purpose expects this one.
    if (m.type() === 'error' && !(expectRevoked && m.text().includes('ERR_FILE_NOT_FOUND')))
      fails.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => fails.push(`pageerror: ${e.message}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)
    })
  })
  return page
}

const axe = async (page, label) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  check(
    violations.length === 0,
    `axe: no WCAG A/AA violations (${label})`,
    violations
      .map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
      .join('\n      '),
  )
}

/**
 * Compares two PNGs (base64) in a blank page: both scaled to 120 px wide, the
 * share of pixels whose colour differs by more than 64/255. Edge anti-aliasing
 * and JPEG ringing stay well under 3%; misplaced content doesn't.
 */
/** Screenshot options for a sheet: the margin guide is UI, not part of the PDF. */
const sheetShot = {
  animations: 'disabled',
  style: '[data-margin-guide] { outline: none !important; }',
}

/**
 * `W` is the width compared at. A page of fine text shifts its lines by a
 * pixel between a screenshot and poppler, and a 120-wide sample lands on ink
 * in one and paper in the other; such pages compare at 30 wide, each pixel
 * the average of a 4×4 block drawn at 120.
 */
const compareImages = async (a, b, W = 120) => {
  const compare = await browser.newPage()
  try {
    return await compare.evaluate(
      async ([srcA, srcB, W]) => {
        const load = (src) =>
          new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.src = `data:image/png;base64,${src}`
          })
        const [ia, ib] = await Promise.all([load(srcA), load(srcB)])
        const H = Math.round((W * ia.height) / ia.width)
        const pixels = (img) => {
          const n = W < 120 ? 4 : 1
          const c = document.createElement('canvas')
          c.width = W * n
          c.height = H * n
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0, W * n, H * n)
          const big = ctx.getImageData(0, 0, W * n, H * n).data
          const out = new Float64Array(W * H * 4)
          for (let y = 0; y < H * n; y++) {
            for (let x = 0; x < W * n; x++) {
              const o = (Math.floor(y / n) * W + Math.floor(x / n)) * 4
              const i = (y * W * n + x) * 4
              for (let k = 0; k < 4; k++) out[o + k] += big[i + k] / (n * n)
            }
          }
          return out
        }
        const pa = pixels(ia)
        const pb = pixels(ib)
        let total = 0
        let far = 0
        for (let i = 0; i < pa.length; i += 4) {
          const d =
            (Math.abs(pa[i] - pb[i]) +
              Math.abs(pa[i + 1] - pb[i + 1]) +
              Math.abs(pa[i + 2] - pb[i + 2])) /
            3
          total += d
          if (d > 64) far += 1
        }
        return { mean: total / (pa.length / 4), farShare: far / (pa.length / 4) }
      },
      [a, b, W],
    )
  } finally {
    await compare.close()
  }
}

const pageNames = (page) =>
  page.$$eval('ol[aria-label] > li button[aria-label^="Page "]', (els) =>
    els.map((el) => (el.getAttribute('aria-label') ?? '').replace(/^Page \d+: /, '')),
  )

// 1. Dark theme applies before first paint, under the real CSP. -------------
{
  const { context, page } = await open({ colorScheme: 'dark' })
  await page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (document.body) {
        window.__themeAtBody = document.documentElement.dataset.theme
        obs.disconnect()
      }
    }).observe(document, { childList: true, subtree: true })
  })
  const res = await page.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const csp = res?.headers()['content-security-policy'] ?? ''
  check(csp.includes("worker-src 'self'"), 'served with the production CSP')
  check(
    (await page.evaluate(() => window.__themeAtBody)) === 'dark',
    'dark theme set before first paint',
  )
  await page.screenshot({ path: join(shots, 'empty-dark.png'), fullPage: true })
  await axe(page, 'empty, dark')
  await context.close()
}

// 2. The full flow, light theme, desktop. ------------------------------------
const { context, page } = await open({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' })
await page.goto(URL_ROOT, { waitUntil: 'networkidle' })
await page.screenshot({ path: join(shots, 'empty-light.png'), fullPage: true })
await axe(page, 'empty, light')

// Deep link falls back to the app.
{
  const deep = await context.newPage()
  const res = await deep.goto(`${URL_ROOT}some/deep/link`)
  check(
    res?.status() === 200 && (await deep.title()).startsWith('Collated'),
    'deep link serves the app',
  )
  await deep.close()
}

const batch = [
  'quad-landscape.jpg',
  'quad-exif6.jpg',
  'quad-portrait.jpg',
  'quad-landscape.webp',
  'quad-cmyk.jpg',
  'not-an-image.txt',
]
await page.setInputFiles(
  '[data-testid="file-input"]',
  batch.map((f) => join(fixtures, f)),
)
await page.waitForSelector('ol[aria-label="5 pages"]', { timeout: 10_000 })
ok('imported 5 images from a batch of 6 files')
const alert = await page.locator('[role="alert"]').first().textContent()
check(/not-an-image\.txt/.test(alert ?? ''), 'the unreadable file is reported by name', alert ?? '')
check(
  (await page.locator('#status').textContent())?.includes('Added 5 pages'),
  'status announces the import',
)

// The EXIF-rotated photo's preview is upright (landscape), like the original.
const exifThumb = await page.$eval('[aria-label="Page 2: quad-exif6.jpg"] img', (img) => ({
  w: img.naturalWidth,
  h: img.naturalHeight,
}))
check(
  exifThumb.w > exifThumb.h,
  'EXIF orientation applied to the preview',
  JSON.stringify(exifThumb),
)
await page.screenshot({ path: join(shots, 'workspace.png'), fullPage: true })
await axe(page, 'workspace')

// Keyboard reorder: pick up page 1, move it one place right, drop.
await page.getByRole('button', { name: 'Reorder page 1' }).focus()
await page.keyboard.press('Space')
await page.waitForTimeout(150)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(400)
await page.keyboard.press('Space')
await page.waitForTimeout(500)
const afterKeyboard = await pageNames(page)
check(
  afterKeyboard[0] === 'quad-exif6.jpg' && afterKeyboard[1] === 'quad-landscape.jpg',
  'keyboard reorder moves page 1 to position 2',
  afterKeyboard.join(', '),
)

// Undo restores the order; redo re-applies it.
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Control+z')
check((await pageNames(page))[0] === 'quad-landscape.jpg', 'Ctrl+Z undoes the move')
await page.keyboard.press('Control+Shift+z')
check((await pageNames(page))[0] === 'quad-exif6.jpg', 'Ctrl+Shift+Z redoes it')

// Inspector: select the portrait page, rotate, straighten, scale.
await page.getByRole('button', { name: 'Page 3: quad-portrait.jpg' }).click()
const inspector = page.locator('aside[aria-label="Selected page"]')
await inspector.getByRole('button', { name: 'Right' }).click()
const straighten = inspector.getByLabel('Straighten')
await straighten.focus()
for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight') // +5°
const scale = inspector.getByLabel('Scale', { exact: true })
await scale.fill('80')
await scale.dispatchEvent('change')
check(
  (await inspector.locator('output').allTextContents()).join(' ') === '+5.0° 80%',
  'inspector shows the rotation and scale',
  (await inspector.locator('output').allTextContents()).join(' '),
)
// Ten arrow presses on the slider are one undo step, not ten.
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('Control+z')
await page.keyboard.press('Control+z')
check(
  (await inspector.locator('output').first().textContent()) === '0.0°',
  'a slider drag undoes in one step',
  (await inspector.locator('output').first().textContent()) ?? '',
)
await page.keyboard.press('Control+Shift+z')
await page.keyboard.press('Control+Shift+z')

// Document settings: Letter with a half-inch margin and a title.
await pageSetup(page, async (panel) => {
  await panel.getByLabel('Page size').selectOption('letter')
  await panel.getByLabel(/^Margin/).fill('0.5')
  await panel.getByLabel(/^Margin/).press('Tab')
})
await setTitle(page, 'Verify run')
await page.screenshot({ path: join(shots, 'inspector.png'), fullPage: true })

// Export and inspect the PDF.
const [download] = await Promise.all([page.waitForEvent('download'), exportNow(page)])
check(
  download.suggestedFilename() === 'Verify-run.pdf',
  'download is named from the title',
  download.suggestedFilename(),
)
const pdfPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-')), 'out.pdf')
await download.saveAs(pdfPath)
const pdfBytes = readFileSync(pdfPath)
const pdf = await PDFDocument.load(pdfBytes)
const sizes = pdf.getPages().map((p) => `${Math.round(p.getWidth())}×${Math.round(p.getHeight())}`)
check(pdf.getPageCount() === 5, 'PDF has 5 pages', String(pdf.getPageCount()))
check(pdf.getTitle() === 'Verify run', 'PDF title metadata is set')
check(
  sizes.every((s) => s === '612×792' || s === '792×612'),
  'every page is US Letter, turned to suit its image',
  sizes.join(', '),
)
check(
  pdfBytes.includes(readFileSync(join(fixtures, 'quad-landscape.jpg'))),
  'the plain JPEG is embedded byte-for-byte',
)
check(
  !pdfBytes.includes(Buffer.from('Exif\0')) && !pdfBytes.includes(Buffer.from('mattblack.space')),
  'no EXIF from the phone photo, and no tool URL, in the file',
)

// Preview ≡ PDF: render page 3 with poppler and compare it to the inspector's sheet.
let hasPoppler = true
try {
  execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' })
} catch {
  hasPoppler = false
}
if (hasPoppler) {
  const prefix = pdfPath.replace(/\.pdf$/, '')
  execFileSync('pdftoppm', [
    '-png',
    '-r',
    '72',
    '-f',
    '3',
    '-l',
    '3',
    '-singlefile',
    pdfPath,
    prefix,
  ])
  const rendered = readFileSync(`${prefix}.png`).toString('base64')
  const sheet = inspector.locator('.sheet').first()
  const preview = (await sheet.screenshot(sheetShot)).toString('base64')
  writeFileSync(join(shots, 'page3-pdf.png'), Buffer.from(rendered, 'base64'))
  writeFileSync(join(shots, 'page3-preview.png'), Buffer.from(preview, 'base64'))
  const diff = await compareImages(rendered, preview)
  // Edge anti-aliasing and JPEG ringing differ; misplacement shows up as a
  // large share of pixels in the wrong colour.
  check(
    diff.farShare < 0.03,
    `on-screen preview matches the PDF render (mean Δ ${diff.mean.toFixed(1)}/255, ${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
  )
} else {
  console.log('  --  pdftoppm not installed; skipped preview ≡ PDF comparison')
}

// Clearing the import error notice.
await page.getByRole('button', { name: 'Dismiss' }).first().click()
check((await page.locator('[role="alert"]').count()) === 0, 'notices can be dismissed')
await context.close()

// 3. PDFs: merge pages from PDFs alongside images. ----------------------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    [
      'quad-3pages.pdf',
      'quad-rotate90.pdf',
      'quad-password.pdf',
      'quad-owner-locked.pdf',
      'quad-landscape.jpg',
    ].map((f) => join(fixtures, f)),
  )
  // The password-protected one asks first (#114); skipped here, opened in step 37.
  await p
    .getByRole('dialog', { name: 'Password for quad-password.pdf' })
    .getByRole('button', { name: 'Skip this file' })
    .click({ timeout: 20_000 })
  await p.waitForSelector('ol[aria-label="8 pages"]', { timeout: 20_000 })
  ok('imported 3 + 1 + 3 PDF pages and an image; the password-protected PDF was skipped')
  const alertText = (await p.locator('[role="alert"]').allTextContents()).join(' ')
  check(
    /quad-password\.pdf: .*password/i.test(alertText),
    'the password-protected PDF is reported by name',
    alertText,
  )
  const rotated = await p.$eval('[aria-label="Page 4: quad-rotate90.pdf"] img', (img) => ({
    w: img.naturalWidth,
    h: img.naturalHeight,
  }))
  check(
    rotated.w > rotated.h,
    'a PDF page with /Rotate 90 previews upright (landscape)',
    JSON.stringify(rotated),
  )
  await p.getByRole('button', { name: 'Page 4: quad-rotate90.pdf' }).click()
  const inspectorPdf = p.locator('aside[aria-label="Selected page"]')
  check(
    (await inspectorPdf.textContent())?.includes('Vector, any size') ?? false,
    'the inspector reports PDF pages as vector',
  )
  await p.screenshot({ path: join(shots, 'pdf-merge.png'), fullPage: true })
  await axe(p, 'PDF pages')

  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const outPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-pdf-')), 'merged.pdf')
  await dl.saveAs(outPath)
  const merged = await PDFDocument.load(readFileSync(outPath))
  check(merged.getPageCount() === 8, 'merged PDF has all 8 pages', String(merged.getPageCount()))
  const images =
    readFileSync(outPath)
      .toString('latin1')
      .match(/\/Subtype\s*\/Image/g) ?? []
  check(
    images.length === 1,
    'PDF pages stay vector (the only raster is the JPEG)',
    `${images.length} images`,
  )

  // Split by ranges (#66): one ZIP, built in the worker, of a PDF per range.
  await exportMenu(p).click()
  const options = p.getByRole('dialog', { name: 'Export options' })
  await options.getByRole('radio', { name: 'Split by page ranges' }).check()
  await options.getByRole('textbox', { name: 'Page ranges' }).fill('1-3, 7-')
  check(
    (await options.textContent())?.includes('2 PDFs in one ZIP: pages 1–3 · 7–8.') ?? false,
    'the export options say what a split will make',
  )
  await axe(p, 'export options, split by ranges')
  const [zipped] = await Promise.all([
    p.waitForEvent('download'),
    options.getByRole('button', { name: 'Export 2 PDFs' }).click(),
  ])
  check(
    /\.zip$/.test(zipped.suggestedFilename()),
    'a split export downloads as a ZIP',
    zipped.suggestedFilename(),
  )
  const zipPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-zip-')), 'split.zip')
  await zipped.saveAs(zipPath)
  const entries = unzipSync(readFileSync(zipPath))
  const counts = await Promise.all(
    Object.entries(entries).map(
      async ([name, bytes]) => `${name}:${String((await PDFDocument.load(bytes)).getPageCount())}`,
    ),
  )
  check(
    counts.length === 2 && /-part-1\.pdf:3$/.test(counts[0]) && /-part-2\.pdf:2$/.test(counts[1]),
    'the ZIP holds one PDF per range, with its pages',
    counts.join(', '),
  )
  await exportMenu(p).click()
  await options.getByRole('radio', { name: 'All pages' }).check()
  await p.keyboard.press('Escape')
  await options.waitFor({ state: 'hidden' })

  if (hasPoppler) {
    // Preview ≡ PDF for the rotated PDF page, as for images above.
    const prefix = outPath.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      '4',
      '-l',
      '4',
      '-singlefile',
      outPath,
      prefix,
    ])
    const diff = await compareImages(
      readFileSync(`${prefix}.png`).toString('base64'),
      (await inspectorPdf.locator('.sheet').first().screenshot(sheetShot)).toString('base64'),
    )
    check(
      diff.farShare < 0.03,
      `rotated PDF page: preview matches the export (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
  }
  await ctx.close()
}

// 4. Filters: greyscale, Enhance and B&W, preview matching export. -----------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-landscape.jpg', 'quad-exif6.jpg', 'doc-photo.jpg', 'doc-colour.jpg'].map((f) =>
      join(fixtures, f),
    ),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]')
  const panel = p.locator('aside[aria-label="Selected page"]')

  await p.getByRole('button', { name: 'Page 1: quad-landscape.jpg' }).click()
  await panel.getByRole('radio', { name: 'B&W' }).check({ force: true })
  await p.getByRole('button', { name: 'Page 2: quad-exif6.jpg' }).click()
  await panel.getByRole('radio', { name: 'Greyscale' }).check({ force: true })
  await p.waitForTimeout(500) // filtered thumbnails are made asynchronously
  const greyPreview = (await panel.locator('.sheet').first().screenshot(sheetShot)).toString(
    'base64',
  )
  await p.getByRole('button', { name: 'Page 1: quad-landscape.jpg' }).click()
  await p.waitForTimeout(300)
  const bwPreview = (await panel.locator('.sheet').first().screenshot(sheetShot)).toString('base64')
  // The case B&W is for: a photographed page with a shadow across it.
  await p.getByRole('button', { name: 'Page 3: doc-photo.jpg' }).click()
  await panel.getByRole('radio', { name: 'B&W' }).check({ force: true })
  await p.waitForTimeout(500)
  await panel
    .locator('.sheet')
    .first()
    .screenshot({ ...sheetShot, path: join(shots, 'doc-bw.png') })
  await panel.getByRole('radio', { name: 'Original' }).check({ force: true })
  await p.waitForTimeout(200)
  await panel
    .locator('.sheet')
    .first()
    .screenshot({ ...sheetShot, path: join(shots, 'doc-original.png') })
  await panel.getByRole('radio', { name: 'B&W' }).check({ force: true })
  // The case Enhance is for: a colour document photographed in uneven light.
  await p.getByRole('button', { name: 'Page 4: doc-colour.jpg' }).click()
  await panel.getByRole('radio', { name: 'Enhance' }).check({ force: true })
  await p.waitForTimeout(500)
  const enhancePreview = (
    await panel
      .locator('.sheet')
      .first()
      .screenshot({ ...sheetShot, path: join(shots, 'doc-enhance.png') })
  ).toString('base64')
  await p.screenshot({ path: join(shots, 'filters.png'), fullPage: true })

  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const outPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-filter-')), 'filtered.pdf')
  await dl.saveAs(outPath)
  const out = readFileSync(outPath)
  check(
    !out.includes(readFileSync(join(fixtures, 'quad-landscape.jpg'))),
    'filtered pages are re-encoded rather than passed through',
  )
  if (hasPoppler) {
    const prefix = outPath.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', ['-png', '-r', '72', outPath, prefix])
    const [bwRender, greyRender, enhanceRender] = ['1', '2', '4'].map((n) =>
      readFileSync(`${prefix}-${n}.png`).toString('base64'),
    )
    const enhance = await compareImages(enhanceRender, enhancePreview, 30)
    // The mean too: the unfiltered photo's warm paper is only ~25 levels off
    // white, under the 64 that counts a pixel as different.
    check(
      enhance.farShare < 0.03 && enhance.mean < 10,
      `Enhance page: preview matches the export (mean Δ ${enhance.mean.toFixed(1)}/255, ${(enhance.farShare * 100).toFixed(2)}% differ)`,
    )
    const bw = await compareImages(bwRender, bwPreview)
    const grey = await compareImages(greyRender, greyPreview)
    check(
      bw.farShare < 0.03,
      `B&W page: preview matches the export (${(bw.farShare * 100).toFixed(2)}% differ)`,
    )
    check(
      grey.farShare < 0.03,
      `greyscale EXIF-rotated page: preview matches the export (${(grey.farShare * 100).toFixed(2)}% differ)`,
    )
    const tones = await p.evaluate(
      async ([bwSrc, greySrc, enhanceSrc]) => {
        const read = async (src) => {
          const img = new Image()
          img.src = `data:image/png;base64,${src}`
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          return g.getImageData(0, 0, c.width, c.height).data
        }
        const [b, gr, en] = await Promise.all([read(bwSrc), read(greySrc), read(enhanceSrc)])
        let notBinary = 0
        for (let i = 0; i < b.length; i += 4) {
          const v = b[i]
          if (v > 40 && v < 215) notBinary += 1
        }
        let coloured = 0
        for (let i = 0; i < gr.length; i += 4) {
          if (Math.max(gr[i], gr[i + 1], gr[i + 2]) - Math.min(gr[i], gr[i + 1], gr[i + 2]) > 12)
            coloured += 1
        }
        // Enhance: the warm, shadowed paper comes out white; the logo,
        // highlight and stamp keep strong colour.
        let white = 0
        let vivid = 0
        for (let i = 0; i < en.length; i += 4) {
          const lo = Math.min(en[i], en[i + 1], en[i + 2])
          const hi = Math.max(en[i], en[i + 1], en[i + 2])
          if (lo > 235) white += 1
          if (hi - lo > 100) vivid += 1
        }
        const n = en.length / 4
        return {
          notBinary: notBinary / (b.length / 4),
          coloured: coloured / (gr.length / 4),
          white: white / n,
          vivid: vivid / n,
        }
      },
      [bwRender, greyRender, enhanceRender],
    )
    check(
      tones.notBinary < 0.01,
      `B&W page is black and white (${(tones.notBinary * 100).toFixed(2)}% mid-tones)`,
    )
    check(
      tones.coloured < 0.01,
      `greyscale page has no colour (${(tones.coloured * 100).toFixed(2)}% coloured)`,
    )
    check(
      tones.white > 0.6 && tones.vivid > 0.01,
      `Enhance page has white paper and kept its colours (${(tones.white * 100).toFixed(1)}% white, ${(tones.vivid * 100).toFixed(2)}% vivid)`,
    )
  }
  await ctx.close()
}

// 5. Compression and size limits. ---------------------------------------------
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'scan-letter-300dpi.jpg'),
    join(fixtures, 'scan-letter-300dpi.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  const exportAndMeasure = async (name) => {
    const [d] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
    const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-size-')), name)
    await d.saveAs(path)
    await exportMenu(p).waitFor({ state: 'visible' })
    await p.waitForFunction(() => !/Building|Shrinking/.test(document.body.innerText))
    return { path, bytes: readFileSync(path).byteLength }
  }
  const original = await exportAndMeasure('original.pdf')

  // The real popover: opened by its button, closed with Escape.
  const optionsButton = exportMenu(p)
  await optionsButton.click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  check(await dialog.isVisible(), 'export options open in a popover')
  await axe(p, 'export options')
  await dialog.getByRole('radio', { name: /Small/ }).check()
  const estimateLabel = (await dialog.locator('dd').first().textContent()) ?? ''
  await p.screenshot({ path: join(shots, 'export-options.png') })
  await p.keyboard.press('Escape')
  check(!(await dialog.isVisible()), 'Escape closes the export options')

  const small = await exportAndMeasure('small.pdf')
  check(
    small.bytes < original.bytes * 0.5,
    `Small quality shrinks a 300 dpi scan (${(original.bytes / 1e6).toFixed(2)} MB → ${(small.bytes / 1e6).toFixed(2)} MB)`,
  )
  const estimated = /≈ ([\d.]+) (KB|MB)/.exec(estimateLabel)
  if (estimated) {
    const est = Number(estimated[1]) * (estimated[2] === 'MB' ? 1024 * 1024 : 1024)
    console.log(
      `  --  estimate ${(est / 1e6).toFixed(2)} MB vs actual ${(small.bytes / 1e6).toFixed(2)} MB (${Math.round((est / small.bytes - 1) * 100)}%)`,
    )
  }
  if (hasPoppler) {
    const prefix = small.path.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      small.path,
      prefix,
    ])
    const orig = original.path.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      original.path,
      orig,
    ])
    const diff = await compareImages(
      readFileSync(`${prefix}.png`).toString('base64'),
      readFileSync(`${orig}.png`).toString('base64'),
    )
    check(
      diff.farShare < 0.01,
      `Small looks the same as Original at screen size (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
  }

  // A limit tighter than Small: lower steps are tried until it fits.
  await optionsButton.click()
  const limit = dialog.getByLabel('Keep the file under')
  const target = Math.max(0.1, Math.floor((small.bytes / (1024 * 1024)) * 6) / 10)
  await limit.fill(String(target))
  await limit.press('Enter')
  await p.keyboard.press('Escape')
  const limited = await exportAndMeasure('limited.pdf')
  const alerts = await p.locator('[role="alert"]').allTextContents()
  check(
    limited.bytes <= target * 1024 * 1024 || alerts.some((a) => a.includes('Couldn’t get under')),
    `a ${target} MB limit is met (${(limited.bytes / 1e6).toFixed(2)} MB) or reported`,
  )
  check(
    /\d+ dpi/.test((await p.locator('#status').textContent()) ?? ''),
    'the status reports which resolution the export used',
    (await p.locator('#status').textContent()) ?? '',
  )
  await ctx.close()
}

// 6. Page numbers, password, match-image size. --------------------------------
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'doc-photo.jpg'),
    join(fixtures, 'quad-landscape.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  await pageSetup(p, async (panel) => {
    await panel.getByLabel(/^Margin/).fill('0.5')
    await panel.getByLabel(/^Margin/).press('Tab')
  })
  const optionsButton = exportMenu(p)
  await optionsButton.click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.getByRole('checkbox', { name: 'Page numbers' }).check()
  await dialog.getByLabel('Position').selectOption('bottom-right')
  await dialog.getByLabel('Password to open').fill('correct horse')
  await axe(p, 'export options with numbers and password')
  const [locked] = await Promise.all([
    p.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export locked PDF' }).click(),
  ])
  const lockedPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-lock-')), 'locked.pdf')
  await locked.saveAs(lockedPath)
  const lockedBytes = readFileSync(lockedPath)
  let refused = false
  try {
    await PDFDocument.load(lockedBytes)
  } catch {
    refused = true
  }
  check(refused, 'the locked PDF does not open without its password')
  const unlocked = await PDFDocument.load(lockedBytes, { password: 'correct horse' })
  check(unlocked.getPageCount() === 2, 'the locked PDF opens with its password')

  // The number on page 1: where the preview draws it vs where the PDF has it.
  await p.getByRole('button', { name: 'Page 1: doc-photo.jpg' }).click()
  const panel = p.locator('aside[aria-label="Selected page"]')
  const previewBox = await panel
    .locator('.sheet')
    .first()
    .evaluate((sheet) => {
      const s = sheet.getBoundingClientRect()
      const n = [...sheet.querySelectorAll('span')].find((e) => e.textContent === '1')
      const r = n?.getBoundingClientRect()
      return r ? { x: (r.right - s.left) / s.width, y: (r.bottom - s.top) / s.height } : null
    })
  const pdftotext = (() => {
    try {
      return execFileSync('pdftotext', [
        '-upw',
        'correct horse',
        '-bbox',
        '-f',
        '1',
        '-l',
        '1',
        lockedPath,
        '-',
      ]).toString()
    } catch {
      return null
    }
  })()
  if (pdftotext && previewBox) {
    const page = /<page width="([\d.]+)" height="([\d.]+)"/.exec(pdftotext)
    const word =
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">1<\/word>/.exec(
        pdftotext,
      )
    if (page && word) {
      const pdfBox = { x: Number(word[3]) / Number(page[1]), y: Number(word[4]) / Number(page[2]) }
      const off = Math.max(Math.abs(pdfBox.x - previewBox.x), Math.abs(pdfBox.y - previewBox.y))
      check(
        off < 0.01,
        `page number sits where the PDF puts it (within ${(off * 100).toFixed(2)}% of the page)`,
      )
    } else fails.push('page number not found in the PDF text')
  }

  // Match image: pages take their image's size at the chosen dpi.
  await pageSetup(p, async (panel) => {
    await panel.getByLabel('Page size').selectOption('image')
    await panel.getByLabel('Image dpi').fill('150')
    await panel.getByLabel('Image dpi').press('Tab')
  })
  await optionsButton.click()
  await dialog.getByLabel('Password to open').fill('')
  // Listen first: with the export worker already loaded, the file can be
  // ready before a listener added after the click.
  const [matched] = await Promise.all([
    p.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  const matchedPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-match-')), 'matched.pdf')
  await matched.saveAs(matchedPath)
  const sizes = (await PDFDocument.load(readFileSync(matchedPath)))
    .getPages()
    .map((pg) => `${Math.round(pg.getWidth())}×${Math.round(pg.getHeight())}`)
  // 900 x 1200 px and 240 x 160 px at 150 dpi, plus a 0.5 in margin each side.
  check(
    sizes.join(', ') === '504×648, 187×149',
    'match-image pages are the image at 150 dpi plus margins',
    sizes.join(', '),
  )
  await p.screenshot({ path: join(shots, 'match-image.png'), fullPage: true })
  await ctx.close()
}

// 7. HEIC in a browser without native support (Chromium), via libheif. --------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.heic'),
    join(fixtures, 'quad-landscape.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]', { timeout: 20_000 })
  ok('a HEIC photo imports where the browser has no HEIC decoder')
  const [d] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-heic-')), 'heic.pdf')
  await d.saveAs(path)
  if (hasPoppler) {
    const prefix = path.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', ['-png', '-r', '36', path, prefix])
    const diff = await compareImages(
      readFileSync(`${prefix}-1.png`).toString('base64'),
      readFileSync(`${prefix}-2.png`).toString('base64'),
    )
    check(
      diff.farShare < 0.02,
      `the HEIC page matches the same image as JPEG (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
  }
  await ctx.close()
}

// 8. Auto-straighten a photo shot 4° off. -------------------------------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'doc-skewed-4deg.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  const panel = p.locator('aside[aria-label="Selected page"]')
  await panel.getByRole('button', { name: 'Auto-straighten' }).click()
  await p.waitForFunction(() =>
    /Straightened|No clear lines/.test(document.getElementById('status')?.textContent ?? ''),
  )
  const angle = Number(
    ((await panel.locator('output').first().textContent()) ?? '').replace('°', ''),
  )
  check(Math.abs(angle + 4) <= 0.5, `auto-straighten levels a photo shot 4° off (set ${angle}°)`)
  await p.screenshot({ path: join(shots, 'straightened.png'), fullPage: true })
  await ctx.close()
}

// 9. Perspective crop: drag the corners onto the paper. ------------------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'doc-skewed-4deg.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  const panel = p.locator('aside[aria-label="Selected page"]')
  await panel.getByRole('button', { name: 'Crop to the page…' }).click()
  const dialog = p.getByRole('dialog', { name: 'Crop to the page' })
  // It opens once the paper has been looked for (in a worker).
  await dialog.waitFor({ timeout: 5000 }).catch(() => undefined)
  check(await dialog.isVisible(), 'the crop editor opens as a modal dialog')
  await axe(p, 'crop editor')
  // The paper's corners in the fixture, worked out from how it was made
  // (a 900 × 1200 page turned 4° clockwise onto a 982 × 1260 photo).
  const paper = [
    [0.0855, 0.0001],
    [0.9998, 0.0499],
    [0.9145, 0.9999],
    [0.0002, 0.9501],
  ]
  const stage = await dialog.locator('img').boundingBox()
  const names = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']
  for (const [i, [nx, ny]] of paper.entries()) {
    const handle = dialog.getByRole('button', { name: new RegExp(`^${names[i]} corner`) })
    const box = await handle.boundingBox()
    if (!stage || !box) throw new Error('crop editor layout')
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await p.mouse.down()
    await p.mouse.move(stage.x + nx * stage.width, stage.y + ny * stage.height, { steps: 6 })
    await p.mouse.up()
  }
  await p.screenshot({ path: join(shots, 'crop-editor.png') })
  await dialog.getByRole('button', { name: 'Apply crop' }).click()
  check(!(await dialog.isVisible()), 'applying closes the crop editor')
  await p.waitForTimeout(500) // cropped preview is made asynchronously
  const preview = (await panel.locator('.sheet').first().screenshot(sheetShot)).toString('base64')

  const [d] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-crop-')), 'crop.pdf')
  await d.saveAs(path)
  if (hasPoppler) {
    const prefix = path.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', ['-png', '-r', '72', '-singlefile', path, prefix])
    const render = readFileSync(`${prefix}.png`).toString('base64')
    const diff = await compareImages(render, preview)
    check(
      diff.farShare < 0.03,
      `cropped preview matches the export (${(diff.farShare * 100).toFixed(2)}% differ)`,
    )
    const shape = await p.evaluate(async (src) => {
      const img = new Image()
      img.src = `data:image/png;base64,${src}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const { data } = g.getImageData(0, 0, c.width, c.height)
      let minX = c.width,
        minY = c.height,
        maxX = 0,
        maxY = 0,
        table = 0
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4
          if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) continue
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
      // The table is darker and redder than any paper, shadow included.
      const ring = 4
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (x - minX > ring && maxX - x > ring && y - minY > ring && maxY - y > ring) continue
          const i = (y * c.width + x) * 4
          if (data[i] < 80 && data[i] - data[i + 2] > 10) table += 1
        }
      }
      return { aspect: (maxX - minX + 1) / (maxY - minY + 1), table }
    }, render)
    check(
      Math.abs(shape.aspect - 0.75) < 0.015,
      `the cropped page has the paper's 3:4 shape (${shape.aspect.toFixed(3)})`,
    )
    check(shape.table < 20, `no table is left around the edges (${shape.table} px)`)
  }
  await ctx.close()
}

// 9b. Finding the paper: the crop editor opens on it; auto-crop all pages. ----
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const truth = JSON.parse(readFileSync(join(fixtures, 'paper-corners.json'), 'utf8'))
  const photos = Object.keys(truth)
  await p.setInputFiles(
    '[data-testid="file-input"]',
    [...photos, 'doc-photo.jpg'].map((name) => join(fixtures, name)),
  )
  await p.waitForSelector(`ol[aria-label="${photos.length + 1} pages"]`)
  const panel = p.locator('aside[aria-label="Selected page"]')
  const names = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']
  /** The editor's corners, as fractions, read from each handle's description. */
  const cornersIn = async (dialog) => {
    const out = []
    for (const name of names) {
      const handle = dialog.getByRole('button', { name: `${name} corner`, exact: true })
      const at = await handle.evaluate(
        (el) =>
          document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      )
      const [x, y] = (at.match(/[\d.]+/g) ?? []).map((n) => Number(n) / 100)
      out.push([x, y])
    }
    return out
  }
  const worst = (found, expected) =>
    Math.max(
      ...found.map(([x, y], i) =>
        Math.max(Math.abs(x - expected[i][0]), Math.abs(y - expected[i][1])),
      ),
    )
  for (const [i, name] of photos.entries()) {
    await p.getByRole('button', { name: `Page ${i + 1}: ${name}` }).click()
    await panel.getByRole('button', { name: 'Crop to the page…' }).click()
    const dialog = p.getByRole('dialog', { name: 'Crop to the page' })
    await dialog.waitFor()
    const off = worst(await cornersIn(dialog), truth[name])
    check(
      off <= 0.02,
      `the crop editor opens on the paper in ${name} (worst corner ${(off * 100).toFixed(1)}% off)`,
    )
    if (i === 0) await p.screenshot({ path: join(shots, 'crop-found.png') })
    await p.keyboard.press('Escape')
  }
  // A page that's all paper opens on the whole image.
  await p.getByRole('button', { name: `Page ${photos.length + 1}: doc-photo.jpg` }).click()
  await panel.getByRole('button', { name: 'Crop to the page…' }).click()
  const whole = p.getByRole('dialog', { name: 'Crop to the page' })
  await whole.waitFor()
  check(
    worst(await cornersIn(whole), [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) === 0,
    'with no sheet to find, the crop editor opens on the whole image',
  )
  await p.keyboard.press('Escape')

  await panel.getByRole('button', { name: 'Auto-crop all pages' }).click()
  await p.waitForFunction(() =>
    /Cropped \d+ of/.test(document.getElementById('status')?.textContent ?? ''),
  )
  const said = (await p.locator('#status').textContent()) ?? ''
  check(
    said.startsWith(`Cropped ${photos.length} of ${photos.length + 1} pages`),
    'auto-crop all pages crops each photo of paper and skips the scan',
    said,
  )
  await p.screenshot({ path: join(shots, 'auto-cropped.png'), fullPage: true })
  await p.keyboard.press('Control+z')
  await p.getByRole('button', { name: `Page 1: ${photos[0]}` }).click()
  check(
    (await panel.getByRole('button', { name: 'Crop to the page…' }).count()) === 1,
    'one undo takes the auto-crop back',
  )
  await ctx.close()
}

// 10. OCR: a sideways photo of a page, turned upright, made searchable. -------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'text-page-sideways.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await p.getByRole('button', { name: 'Rotate page 1 right' }).click({ force: true })
  await exportMenu(p).click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.getByRole('checkbox', { name: 'Make text searchable (OCR)' }).check()
  const started = Date.now()
  const [d] = await Promise.all([
    p.waitForEvent('download', { timeout: 120_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-ocr-')), 'ocr.pdf')
  await d.saveAs(path)
  const text = (() => {
    try {
      return execFileSync('pdftotext', [path, '-']).toString().replace(/\s+/g, ' ')
    } catch {
      return null
    }
  })()
  if (text !== null) {
    const expected = [
      'quick brown fox jumps over the lazy dog',
      'Invoice number 4417',
      'Searchable text',
    ]
    const missing = expected.filter((phrase) => !text.includes(phrase))
    check(
      missing.length === 0,
      `OCR makes the turned-upright page searchable (first run with downloads: ${seconds} s)`,
      `missing: ${missing.join(' | ')} in "${text.slice(0, 200)}"`,
    )
    // Selecting a word highlights the printed word: its box is over ink.
    const bbox = execFileSync('pdftotext', ['-bbox', path, '-']).toString()
    const fox =
      /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">fox<\/word>/.exec(bbox)
    const pageSize = /<page width="([\d.]+)" height="([\d.]+)"/.exec(bbox)
    if (fox && pageSize && hasPoppler) {
      const prefix = path.replace(/\.pdf$/, '')
      execFileSync('pdftoppm', ['-png', '-r', '72', '-singlefile', path, prefix])
      const ink = await p.evaluate(
        async ([src, box]) => {
          const img = new Image()
          img.src = `data:image/png;base64,${src}`
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          const [x0, y0, x1, y1] = box.map(Math.round)
          const { data } = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
          let dark = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1
          return dark / (data.length / 4)
        },
        [readFileSync(`${prefix}.png`).toString('base64'), fox.slice(1, 5).map(Number)],
      )
      check(
        ink > 0.08,
        `the searchable word "fox" sits over the printed word (${(ink * 100).toFixed(0)}% ink in its box)`,
      )
    }
  }
  await ctx.close()
}

// 11. Phone-sized, dark. -------------------------------------------------------
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'quad-portrait.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  // Against the device width, not innerWidth: a mobile browser widens its
  // layout viewport to fit wide content, which hid an overflowing toolbar.
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 390)
  check(overflow <= 0, 'no horizontal scroll on a phone', `${overflow}px`)
  await p.getByRole('button', { name: 'Page 1: quad-landscape.jpg' }).click()
  await p.screenshot({ path: join(shots, 'phone-dark.png'), fullPage: true })
  await axe(p, 'phone, dark')
  await phone.close()
}

// 12. Accessibility: focus is never dropped, reorders are announced right. ----
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-landscape.jpg', 'quad-portrait.jpg', 'quad-exif6.jpg', 'doc-photo.jpg'].map((f) =>
      join(fixtures, f),
    ),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]')
  const focused = () =>
    p.evaluate(() => {
      const a = document.activeElement
      return a && a !== document.body
        ? (a.getAttribute('aria-label') ?? a.textContent ?? '')
        : 'body'
    })
  const dndSays = () =>
    p.evaluate(() => document.querySelector('[id^="dnd-kit-announcement"]')?.textContent ?? '')

  // dnd-kit's live region: the target position and the real page count.
  await p.getByRole('button', { name: 'Reorder page 1' }).focus()
  await p.keyboard.press('Space')
  await p.waitForTimeout(150)
  await p.keyboard.press('ArrowRight')
  await p.waitForTimeout(800) // dragover announcements are debounced (500 ms)
  const over = await dndSays()
  check(over === 'Page moved to position 2 of 4.', 'reorder announces where the page moved', over)
  await p.keyboard.press('Space')
  await p.waitForTimeout(500)
  const dropped = await dndSays()
  check(dropped === 'Page dropped at position 2 of 4.', 'reorder announces the drop', dropped)

  // Removing from the grid moves focus to the page that took its place.
  await p.getByRole('button', { name: 'Remove page 2' }).focus()
  await p.keyboard.press('Enter')
  check(
    /^Page 2: /.test(await focused()),
    'removing a page from the grid focuses the next page',
    await focused(),
  )

  // Moving a page to the front: focus goes to "Move page later".
  await p.getByRole('button', { name: /^Page 2: / }).click()
  const panel = p.locator('aside[aria-label="Selected page"]')
  await panel.getByRole('button', { name: 'Move page earlier' }).focus()
  await p.keyboard.press('Enter')
  check(
    (await focused()) === 'Move page later',
    'moving a page to the front keeps focus on the reorder buttons',
    await focused(),
  )

  // Removing in the inspector: focus and selection go to the next page.
  await panel.getByRole('button', { name: 'Remove' }).focus()
  await p.keyboard.press('Enter')
  check(
    /^Page 1: /.test(await focused()),
    'removing in the inspector focuses the page in its place',
    await focused(),
  )

  // Undo is announced.
  await p.keyboard.press('Control+z')
  const undone = (await p.locator('#status').textContent()) ?? ''
  check(/^Undone: removed page 1\./.test(undone), 'undo is announced', undone)

  // Export from the keyboard: the menu opens on Enter, Export is the last
  // control, and focus comes back to the menu button, which keeps it while busy.
  await exportMenu(p).focus()
  await p.keyboard.press('Enter')
  const exportDialog = p.getByRole('dialog', { name: 'Export options' })
  await exportDialog.waitFor()
  await exportDialog.getByRole('button', { name: 'Export PDF' }).focus()
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Enter')])
  await dl.path()
  await p.waitForFunction(() => /Saved/.test(document.getElementById('status')?.textContent ?? ''))
  check(
    /^Export · \d+ pages?, options$/.test(await focused()),
    'focus returns to the export button and stays through the export',
    await focused(),
  )

  // Export options: a too-long password is refused inline; Tab out closes it.
  await exportMenu(p).click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  const password = dialog.getByLabel('Password to open')
  await password.fill('é'.repeat(64))
  check(
    (await password.getAttribute('aria-invalid')) === 'true',
    'a password over 127 bytes is marked invalid',
  )
  await axe(p, 'export options, password error')
  await dialog.getByRole('button', { name: 'Show password' }).click()
  check((await password.getAttribute('type')) === 'text', 'Show reveals the password')
  await password.fill('ok')
  await dialog.getByRole('button', { name: 'Export locked PDF' }).focus()
  await p.keyboard.press('Tab')
  check(!(await dialog.isVisible()), 'Tab out of export options closes them')
  check(
    (await p
      .getByRole('button', { name: /^Export · .*, locked with a password, options$/ })
      .count()) === 1,
    'the export button says the PDF will be locked',
  )
  await exportMenu(p).click()
  await password.fill('')
  await p.keyboard.press('Escape')

  // Crop: tap a corner, then tap the image, instead of dragging (WCAG 2.5.7).
  await p.getByRole('button', { name: /: doc-photo\.jpg$/ }).click()
  await panel.getByRole('button', { name: 'Crop to the page…' }).click()
  const crop = p.getByRole('dialog', { name: 'Crop to the page' })
  await crop.waitFor()
  const corner = crop.getByRole('button', { name: 'Top-left corner', exact: true })
  await corner.click()
  check((await corner.getAttribute('aria-pressed')) === 'true', 'tapping a corner picks it')
  await axe(p, 'crop editor, corner picked')
  const stage = await crop.locator('img').boundingBox()
  if (!stage) throw new Error('crop editor layout')
  await p.mouse.click(stage.x + stage.width * 0.2, stage.y + stage.height * 0.25)
  const at = await corner.evaluate(
    (el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
  )
  const [ax, ay] = (at.match(/[\d.]+/g) ?? []).map(Number)
  check(
    Math.abs(ax - 20) < 1 && Math.abs(ay - 25) < 1,
    'tapping the image moves the picked corner there',
    at,
  )
  check(
    (await corner.getAttribute('aria-label')) === 'Top-left corner',
    'corner names stay stable as they move',
  )
  // Undo shortcuts wait while the modal dialog is open.
  await p.keyboard.press('Control+z')
  check(
    (await crop.isVisible()) && (await p.locator('ol[aria-label="3 pages"]').count()) === 1,
    'Ctrl+Z does nothing behind the crop dialog',
  )
  await p.keyboard.press('Escape')
  await ctx.close()
}

// 13. Notices: one at a time, Escape dismisses, focused controls stay clear. --
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'not-an-image.txt'),
    join(fixtures, 'quad-password.pdf'),
  ])
  await p
    .getByRole('dialog', { name: 'Password for quad-password.pdf' })
    .getByRole('button', { name: 'Skip this file' })
    .tap({ timeout: 20_000 })
  await p.waitForSelector('ol[aria-label="1 page"]')
  await p.waitForSelector('[role="alert"]')
  check(
    (await p.locator('[role="alert"]').count()) === 1,
    'several failures show as one notice with a count',
  )
  const reserved = await p.evaluate(
    () => getComputedStyle(document.documentElement).scrollPaddingBottom,
  )
  check(
    reserved !== 'auto' && parseFloat(reserved) > 0,
    'room is reserved under a notice',
    reserved,
  )
  // The last control on the page, tabbed to, isn't hidden by the notice.
  const remove = p
    .locator('aside[aria-label="Selected page"]')
    .getByRole('button', { name: 'Remove' })
  await remove.focus()
  const overlap = await p.evaluate(() => {
    const a = document.activeElement?.getBoundingClientRect()
    const n = document.querySelector('[role="alert"]')?.closest('.fixed')?.getBoundingClientRect()
    return a && n ? Math.max(0, Math.min(a.bottom, n.bottom) - Math.max(a.top, n.top)) : -1
  })
  check(overlap === 0, 'a focused control is not covered by the notice', `${overlap}px overlap`)
  await p
    .locator('h1')
    .first()
    .evaluate((h) => {
      h.setAttribute('tabindex', '-1')
      h.focus()
    })
  await p.keyboard.press('Escape')
  await p.keyboard.press('Escape')
  check((await p.locator('[role="alert"]').count()) === 0, 'Escape dismisses notices')
  await ctx.close()
}

// 14. A deploy while the page is open (#42): the export worker loads when the
//     first page arrives, so Export still works after its file is gone; and
//     a missing file is a 404, never the app's HTML.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 800 } })
  const missing = await p.request.get(`${URL_ROOT}assets/pdf.worker-gone.js`)
  check(
    missing.status() === 404 && !(await missing.text()).includes('<html'),
    'a missing asset is a 404, not the app',
    String(missing.status()),
  )
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const loaded = p.waitForEvent('requestfinished', (r) => /pdf\.worker-[^/]*\.js$/.test(r.url()))
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  const workerUrl = (await loaded).url()
  ok('the export worker loads as soon as there is a page')
  // "Deploy": the worker's file disappears from the server.
  const workerFile = join(dist, new URL(workerUrl).pathname)
  renameSync(workerFile, `${workerFile}.away`)
  try {
    const [saved] = await Promise.all([
      p.waitForEvent('download', { timeout: 15_000 }),
      exportNow(p),
    ])
    check(
      (saved.suggestedFilename() ?? '').endsWith('.pdf'),
      'Export still works after the worker file is gone',
    )
  } finally {
    renameSync(`${workerFile}.away`, workerFile)
  }
  await ctx.close()
}

// 15. App shell: the header stays, the pages and the inspector scroll. --------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 720 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    Array.from({ length: 4 }, () =>
      ['quad-landscape.jpg', 'quad-portrait.jpg', 'quad-exif6.jpg'].map((f) => join(fixtures, f)),
    ).flat(),
  )
  await p.waitForSelector('ol[aria-label="12 pages"]')
  const grid = p.locator('section[aria-label="Pages"]')
  await grid.hover()
  await p.mouse.wheel(0, 2000)
  await p.waitForTimeout(300)
  const after = await p.evaluate(() => ({
    window: window.scrollY,
    grid: document.querySelector('section[aria-label="Pages"]')?.scrollTop ?? 0,
    header: document.querySelector('header')?.getBoundingClientRect().top ?? -1,
    page: document.documentElement.scrollHeight - window.innerHeight,
  }))
  check(
    after.window === 0 && after.page <= 0 && after.grid > 0 && after.header === 0,
    'the page grid scrolls on its own; the window and header stay put',
    JSON.stringify(after),
  )
  // The inspector scrolls separately, and a new selection starts at its top.
  const rail = p.locator('aside[aria-label="Selected page"]')
  await rail.hover()
  await p.mouse.wheel(0, 2000)
  await p.waitForTimeout(300)
  const railScrolled = await rail.evaluate((el) => el.scrollTop)
  await p.getByRole('button', { name: /^Page 12:/ }).click()
  await p.waitForTimeout(200)
  check(
    railScrolled > 0 && (await rail.evaluate((el) => el.scrollTop)) === 0,
    'the inspector scrolls on its own and starts at the top for a new page',
    `scrolled ${railScrolled}`,
  )
  // Duplicate selects the copy; its button stays in view (no jump to the top).
  await rail.hover()
  await p.mouse.wheel(0, 3000)
  await p.waitForTimeout(200)
  const duplicate = rail.getByRole('button', { name: 'Duplicate' })
  await duplicate.focus()
  await p.keyboard.press('Enter')
  await p.waitForTimeout(200)
  const dupBox = await duplicate.boundingBox()
  check(
    Boolean(dupBox && dupBox.y >= 0 && dupBox.y + dupBox.height <= 720),
    'Duplicate keeps its button in view (WCAG 2.4.11)',
    JSON.stringify(dupBox),
  )
  await p.keyboard.press('Control+z')
  // Toolbar: one Tab stop, arrow keys along it, Alt+T to reach it.
  await p.keyboard.press('Alt+t')
  check(
    /^Page setup/.test((await p.evaluate(() => document.activeElement?.textContent)) ?? ''),
    'Alt+T focuses the toolbar',
  )
  // Arrowing away from an open popover's button closes the popover.
  await p.keyboard.press('Enter')
  await p.getByRole('dialog', { name: 'Page setup' }).waitFor()
  await p.getByRole('button', { name: /^Page setup/ }).focus()
  await p.keyboard.press('ArrowRight')
  check(
    !(await p.getByRole('dialog', { name: 'Page setup' }).isVisible()),
    'arrowing off Page setup closes its popover',
  )
  await p.keyboard.press('Alt+t')
  await p.keyboard.press('End')
  check(
    (await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'More',
    'End moves to the last toolbar control',
  )
  await p.keyboard.press('Enter')
  const more = p.getByRole('dialog', { name: 'More' })
  await more.waitFor()
  await axe(p, 'More menu open')
  check(
    (await more.getByRole('link', { name: /Support Collated/ }).getAttribute('href')) ===
      'https://ko-fi.com/mtblck',
    'More links to Support Collated',
  )
  await p.keyboard.press('Escape')
  await p.getByRole('button', { name: /^Page setup/ }).click()
  const setup = p.getByRole('dialog', { name: 'Page setup' })
  await setup.waitFor()
  const [button, panel] = await Promise.all([
    p.getByRole('button', { name: /^Page setup/ }).boundingBox(),
    setup.boundingBox(),
  ])
  check(
    Boolean(button && panel && panel.y >= button.y + button.height - 1 && panel.x < button.x + 40),
    'Page setup opens under its button',
    JSON.stringify({ button, panel }),
  )
  await axe(p, 'Page setup open')
  await p.screenshot({ path: join(shots, 'page-setup.png') })
  await p.keyboard.press('Escape')
  check(
    (await p.locator('a[href*="mattblack.space"]').count()) === 0,
    'no link back to the portfolio',
  )
  await ctx.close()
}

// 16. Docs, privacy and terms: static pages under the same CSP. ---------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  const pages = [
    'docs/',
    'docs/getting-started/',
    'docs/adding-pages/',
    'docs/arranging-pages/',
    'docs/page-setup/',
    'docs/exporting/',
    'docs/keyboard/',
    'docs/privacy-and-security/',
    'docs/troubleshooting/',
    'privacy/',
    'terms/',
  ]
  const internal = new Set()
  for (const path of pages) {
    const response = await p.goto(`${URL_ROOT}${path}`, { waitUntil: 'networkidle' })
    check(response?.status() === 200, `${path} is served`)
    check(
      (await p.locator('h1').count()) === 1 &&
        (await p.locator('nav[aria-label="Docs"] [aria-current="page"]').count()) === 1,
      `${path} has one h1 and marks itself in the nav`,
    )
    // Styled by the app's stylesheet: the h1 is in the display face.
    const font = await p.locator('h1').evaluate((h) => getComputedStyle(h).fontFamily)
    check(font.includes('Geist'), `${path} is styled`, font)
    for (const href of await p
      .locator('a[href^="/"]:not([href^="//"])')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href'))))
      internal.add(href)
    await axe(p, path)
  }
  for (const href of internal) {
    const response = await p.request.get(`${ORIGIN}${href}`)
    check(response.status() === 200, `link ${href} resolves`)
  }
  // Typed without the slash, a docs URL still reaches the page, not the app.
  await p.goto(`${URL_ROOT}docs/keyboard`, { waitUntil: 'networkidle' })
  check(
    p.url().endsWith('/docs/keyboard/') && (await p.locator('h1').textContent()) === 'Keyboard',
    'a docs URL without its slash goes to the page',
    p.url(),
  )
  // Dark mode follows the stored theme on docs pages too.
  await p.evaluate(() => localStorage.setItem('mb-theme', 'dark'))
  await p.goto(`${URL_ROOT}docs/`, { waitUntil: 'networkidle' })
  check(
    (await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark',
    'docs pages use the stored theme',
  )
  await p.screenshot({ path: join(shots, 'docs-dark.png'), fullPage: true })
  await axe(p, 'docs, dark')
  await p.evaluate(() => localStorage.removeItem('mb-theme'))
  await p.goto(`${URL_ROOT}docs/exporting/`, { waitUntil: 'networkidle' })
  await p.screenshot({ path: join(shots, 'docs.png'), fullPage: true })

  // The landing view's footer, and the workspace's way to the docs: a new tab,
  // so the pages being worked on aren't lost.
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const footer = p.locator('footer')
  check(
    (await footer.getByRole('link', { name: 'Privacy' }).getAttribute('href')) === '/privacy/' &&
      (await footer.getByRole('link', { name: /Support Collated/ }).getAttribute('href')) ===
        'https://ko-fi.com/mtblck',
    'the landing footer links to privacy and support',
  )
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await p.getByRole('button', { name: 'More' }).click()
  const docsLink = p
    .getByRole('dialog', { name: 'More' })
    .getByRole('link', { name: /Help and docs/ })
  check(
    (await docsLink.getAttribute('target')) === '_blank',
    'docs open in a new tab from the workspace, keeping the pages',
  )
  await ctx.close()
}

// 17. Crop a turned page as shown (#43), with edge handles (#44). ------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  const panel = p.locator('aside[aria-label="Selected page"]')
  await panel.getByRole('button', { name: 'Right' }).click()
  await panel.getByRole('button', { name: 'Crop to the page…' }).click()
  const dialog = p.getByRole('dialog', { name: 'Crop to the page' })
  await dialog.waitFor()
  const img = dialog.getByRole('img')
  await p.waitForFunction(() => document.querySelector('dialog img')?.complete)
  const box = await img.evaluate((el) => el.parentElement?.getBoundingClientRect().toJSON())
  // quad-landscape: red top-left, green top-right, blue bottom-left. Turned
  // clockwise, blue is at the top left and the view is portrait.
  const shot = await p.screenshot({ clip: box })
  const shotPath = join(mkdtempSync(join(tmpdir(), 'collated-crop-')), 'crop.png')
  writeFileSync(shotPath, shot)
  let png = { w: 0, h: 0, tl: [0, 0, 0], tr: [0, 0, 0] }
  try {
    png = JSON.parse(
      execFileSync('python3', [
        '-c',
        'import json,sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert("RGB")\nw,h=im.size\nat=lambda fx,fy: list(im.getpixel((round(w*fx),round(h*fy))))\nprint(json.dumps({"w":w,"h":h,"tl":at(0.3,0.3),"tr":at(0.7,0.3)}))',
        shotPath,
      ]).toString(),
    )
  } catch {
    fails.push('crop check needs python3 with Pillow')
  }
  const blueish = ([r, , b]) => b > 150 && r < 120
  const redish = ([r, g, b]) => r > 150 && g < 120 && b < 120
  check(
    png.h > png.w && blueish(png.tl) && redish(png.tr),
    'the crop editor shows the page turned as it is',
    JSON.stringify(png),
  )
  await p.screenshot({ path: join(shots, 'crop-turned.png') })
  // Drag the top edge straight down: both top corners move, sides stay put.
  const edge = dialog.getByRole('button', { name: 'Top edge' })
  const e = await edge.boundingBox()
  if (e) {
    await p.mouse.move(e.x + e.width / 2, e.y + e.height / 2)
    await p.mouse.down()
    await p.mouse.move(e.x + e.width / 2 + 40, e.y + e.height / 2 + 60, { steps: 6 })
    await p.mouse.up()
  }
  const left = await dialog.getByRole('button', { name: 'Top-left corner' }).getAttribute('style')
  const right = await dialog.getByRole('button', { name: 'Top-right corner' }).getAttribute('style')
  const topOf = (style) => /top: ([\d.]+)%/.exec(style ?? '')?.[1]
  const leftOf = (style) => /left: ([\d.]+)%/.exec(style ?? '')?.[1]
  check(
    topOf(left) === topOf(right) &&
      Number(topOf(left)) > 3 &&
      leftOf(left) === '0%'.replace('%', '') &&
      leftOf(right) === '100',
    'dragging the top edge moves both top corners straight down',
    `${left} | ${right}`,
  )
  await axe(p, 'crop editor, turned, edge handles')
  await ctx.close()
}

// 18. The page viewer (#45): larger, full resolution, pinch and Ctrl+wheel zoom.
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'scan-letter-300dpi.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  const opener = p.getByRole('button', { name: 'View page 1 larger' })
  await opener.click()
  const viewer = p.getByRole('dialog', { name: /^Page 1: / })
  await viewer.waitFor()
  // The thumbnail is 720 px; the viewer swaps in the original.
  await p.waitForFunction(
    () => (document.querySelector('dialog[open] img')?.naturalWidth ?? 0) > 1000,
    undefined,
    { timeout: 10_000 },
  )
  ok('the viewer shows the page at full resolution')
  await axe(p, 'page viewer')
  const level = () => p.locator('[data-zoom-level]').textContent()
  const stage = await p.locator('dialog[open] .cursor-grab').boundingBox()
  if (!stage) throw new Error('viewer layout')
  const cx = stage.x + stage.width / 2
  const cy = stage.y + stage.height / 2
  // A two-finger pinch, as touch input.
  const cdp = await ctx.newCDPSession(p)
  const touch = (type, spread) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - spread, y: cy, id: 1 },
              { x: cx + spread, y: cy, id: 2 },
            ],
    })
  await touch('touchStart', 40)
  for (const spread of [60, 90, 120, 160]) await touch('touchMove', spread)
  await touch('touchEnd', 0)
  const pinched = Number.parseInt((await level()) ?? '0', 10)
  check(pinched >= 300, 'pinching zooms in (about 4× for fingers 4× apart)', `${pinched}%`)
  // Pan by dragging, then Ctrl+wheel (a trackpad pinch) zooms out.
  await p.keyboard.press('0')
  check((await level()) === '100%', '0 fits the page')
  // A touch double-tap zooms to 2× (the browser's own dblclick for touch
  // mustn't undo it); two quick pans don't count as taps.
  // Raw one-finger touches: these make Chromium fire dblclick too, as a
  // real phone does (its synthetic tap gesture doesn't).
  for (let n = 0; n < 2; n++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, id: 4 }],
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await p.waitForTimeout(60)
  }
  await p.waitForTimeout(400)
  check((await level()) === '200%', 'a touch double-tap zooms to 2×', (await level()) ?? '')
  for (const dx of [80, -80]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy, id: 3 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx + dx, y: cy, id: 3 }],
    })
    await touch('touchEnd', 0)
  }
  check((await level()) === '200%', 'two quick pans keep the zoom', (await level()) ?? '')
  // The browser's own zoom keys are left to the browser.
  const prevented = await p.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: '=',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.querySelector('dialog[open]')?.dispatchEvent(event)
    return event.defaultPrevented
  })
  check(!prevented, 'Ctrl+= is left to the browser')
  await p.keyboard.press('0')
  await p.mouse.move(cx, cy)
  await p.keyboard.down('Control')
  await p.mouse.wheel(0, -200)
  await p.keyboard.up('Control')
  await p
    .waitForFunction(
      () => document.querySelector('[data-zoom-level]')?.textContent !== '100%',
      undefined,
      { timeout: 3000 },
    )
    .catch(() => undefined)
  const wheeled = Number.parseInt((await level()) ?? '0', 10)
  check(wheeled > 150, 'Ctrl+wheel zooms (a trackpad pinch)', `${wheeled}%`)
  // The window itself never zooms: the page's own scale is untouched.
  check(
    (await p.evaluate(() => window.visualViewport?.scale ?? 1)) === 1,
    'the browser page itself was not zoomed',
  )
  await p.keyboard.press('Escape')
  await viewer.waitFor({ state: 'hidden' })
  check(
    (await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) ===
      'View page 1 larger',
    'closing the viewer returns focus to the preview',
  )
  await ctx.close()
}

// 19. Start over (#29): asks, then clears pages, history and blob URLs. ------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'doc-skewed-4deg.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  const thumb = await p.locator('ol img').first().getAttribute('src')
  const openConfirm = async () => {
    await p.getByRole('button', { name: 'More' }).click()
    await p
      .getByRole('dialog', { name: 'More' })
      .getByRole('button', { name: 'Start over…' })
      .click()
    const confirm = p.getByRole('dialog', { name: 'Start over?' })
    await confirm.waitFor()
    return confirm
  }
  let confirm = await openConfirm()
  check(
    !(await p.getByRole('dialog', { name: 'More' }).isVisible()),
    'Start over closes the More menu behind its confirmation',
  )
  check(
    (await p.evaluate(() => document.activeElement?.textContent)) === 'Cancel',
    'the Start over confirmation opens on Cancel',
  )
  await axe(p, 'Start over confirmation')
  await p.keyboard.press('Escape')
  await confirm.waitFor({ state: 'hidden' })
  check(
    (await p.locator('ol[aria-label="2 pages"]').count()) === 1 &&
      (await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'More',
    'Escape keeps the pages and returns focus to More',
  )
  confirm = await openConfirm()
  await confirm.getByRole('button', { name: 'Start over', exact: true }).click()
  await p.getByRole('button', { name: 'Choose files' }).waitFor()
  check(
    (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'Choose files',
    'after Start over, focus is on Choose files',
  )
  check(
    (await p.locator('#status').textContent())?.startsWith('Started over: removed 2 pages') ??
      false,
    'Start over is announced',
  )
  // The old thumbnail's object URL was revoked: it no longer loads.
  expectRevoked = true
  const revoked = await p.evaluate(
    (src) =>
      new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(false)
        img.onerror = () => resolve(true)
        img.src = src ?? ''
      }),
    thumb,
  )
  expectRevoked = false
  check(
    (thumb?.startsWith('blob:') ?? false) && revoked,
    'Start over revokes the old thumbnails',
    thumb ?? 'no thumbnail',
  )
  await p.keyboard.press('Control+z')
  check(
    (await p.locator('ol[aria-label$="page"], ol[aria-label$="pages"]').count()) === 0,
    'Undo cannot bring the old document back',
  )
  await ctx.close()
}

// 20. A PDF page that hides a layer goes as the preview draws it. -----------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-layers.pdf', 'quad-3pages.pdf'].map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]', { timeout: 20_000 })
  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const outPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-layers-')), 'layers.pdf')
  await dl.saveAs(outPath)
  const raw = readFileSync(outPath).toString('latin1')
  const images = raw.match(/\/Subtype\s*\/Image/g) ?? []
  check(
    images.length === 1,
    'only the page that hides a layer is drawn; the others stay vector',
    `${images.length} images`,
  )
  if (hasPoppler) {
    const text = execFileSync('pdftotext', [outPath, '-']).toString()
    check(!text.includes('HIDDEN-LAYER-TEXT'), 'the hidden layer’s text is not in the export')
    const prefix = outPath.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      outPath,
      prefix,
    ])
    await p.getByRole('button', { name: /^Page 1: quad-layers\.pdf/ }).click()
    const sheet = p.locator('aside[aria-label="Selected page"] .sheet').first()
    const diff = await compareImages(
      readFileSync(`${prefix}.png`).toString('base64'),
      (await sheet.screenshot(sheetShot)).toString('base64'),
    )
    check(
      diff.farShare < 0.03,
      `the drawn page matches its preview (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
  }
  // With OCR on, the drawn page gets a text layer read from the drawing
  // (#52), placed over the printed words; straightened 4°, so placement has
  // a rotation to get right (a quarter turn would leave the text sideways,
  // which OCR, reading the page as shown, can't read).
  await p.getByRole('button', { name: /^Page 1: quad-layers\.pdf/ }).click()
  await p.locator('aside[aria-label="Selected page"]').getByLabel('Straighten').focus()
  for (let i = 0; i < 8; i++) await p.keyboard.press('ArrowRight')
  await exportMenu(p).click()
  const ocrDialog = p.getByRole('dialog', { name: 'Export options' })
  await ocrDialog.getByRole('checkbox', { name: 'Make text searchable (OCR)' }).check()
  const [ocrDl] = await Promise.all([
    p.waitForEvent('download', { timeout: 120_000 }),
    ocrDialog.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  const ocrPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-layers-ocr-')), 'ocr.pdf')
  await ocrDl.saveAs(ocrPath)
  if (hasPoppler) {
    const page1 = execFileSync('pdftotext', ['-f', '1', '-l', '1', ocrPath, '-']).toString()
    check(/Visible\s+words/i.test(page1), 'the drawn page is searchable with OCR on', page1.trim())
    // Each recognised word's box sits over ink on the page as exported.
    const bbox = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-bbox', ocrPath, '-']).toString()
    const words = [
      ...bbox.matchAll(
        /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(Visible|words)<\/word>/gi,
      ),
    ]
    const prefix = ocrPath.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      ocrPath,
      prefix,
    ])
    const inks = await p.evaluate(
      async ([src, boxes]) => {
        const img = new Image()
        img.src = `data:image/png;base64,${src}`
        await img.decode()
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        const g = c.getContext('2d')
        g.drawImage(img, 0, 0)
        return boxes.map((box) => {
          const [x0, y0, x1, y1] = box.map(Math.round)
          const { data } = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0))
          let dark = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1
          return dark / (data.length / 4)
        })
      },
      [
        readFileSync(`${prefix}.png`).toString('base64'),
        words.map((w) => w.slice(1, 5).map(Number)),
      ],
    )
    check(
      words.length >= 2 && inks.every((ink) => ink > 0.08),
      `the drawn page's searchable words sit over the printed words (straightened; ${inks.map((i) => `${(i * 100).toFixed(0)}%`).join(', ')} ink)`,
    )
  }
  await ctx.close()
}

// 21. Export lives in one button (#49); rail actions (#50); select arrows (#51).
{
  const { context: ctx, page: p } = await open({ viewport: { width: 390, height: 640 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  check(
    (await p.getByRole('button', { name: /^Export PDF/ }).count()) === 0,
    'no separate Export button in the toolbar',
  )
  check(
    (await exportMenu(p).textContent())?.startsWith('Export · 1 page,') ?? false,
    'the export button says "Export · 1 page"',
  )
  // On a short phone screen the options scroll and Export stays in view.
  await exportMenu(p).click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.waitFor()
  const exportButton = dialog.getByRole('button', { name: 'Export PDF' })
  const inView = async () => {
    const box = await exportButton.boundingBox()
    return Boolean(box && box.y >= 0 && box.y + box.height <= 640)
  }
  const scroller = dialog.locator('.overflow-y-auto').first()
  const scrolls = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  check(scrolls, 'the export options scroll on a short screen')
  check(await inView(), 'Export is in view before scrolling')
  await scroller.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  check(await inView(), 'Export stays in view with the options scrolled to the end')
  // The panel itself never scrolls, by wheel or touch: only the options do.
  const panelScrolls = await dialog.evaluate((el) => el.scrollHeight > el.clientHeight + 1)
  check(!panelScrolls, 'the export panel itself has nothing to scroll')
  const box = await scroller.boundingBox()
  if (box) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 5; i++) await p.mouse.wheel(0, 400)
  check(
    (await dialog.evaluate((el) => el.scrollTop)) === 0 && (await inView()),
    'wheeling past the end of the options leaves Export in place',
  )
  await p.screenshot({ path: join(shots, 'export-phone.png') })
  await axe(p, 'export options, phone')
  await p.keyboard.press('Escape')
  await ctx.close()
}
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'quad-portrait.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  const rail = p.locator('aside[aria-label="Selected page"]')
  const tops = await Promise.all(
    ['Duplicate', 'Reset', 'Remove'].map(async (name) => {
      const box = await rail.getByRole('button', { name, exact: true }).boundingBox()
      return box ? Math.round(box.y) : -1
    }),
  )
  check(
    new Set(tops).size === 1 && tops[0] !== -1,
    'Duplicate, Reset and Remove share a row',
    tops.join(', '),
  )
  const removeBg = await rail
    .getByRole('button', { name: 'Remove', exact: true })
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  check(
    !/rgba\(0, 0, 0, 0\)|transparent/.test(removeBg),
    'Remove has a filled (accent) background',
    removeBg,
  )
  const styleOf = (name) =>
    rail.getByRole('button', { name, exact: true }).evaluate((el) => {
      const cs = getComputedStyle(el)
      return `${cs.borderTopColor} ${cs.backgroundColor}`
    })
  const duplicateStyle = await styleOf('Duplicate')
  for (const name of ['All pages', 'Apply to all pages']) {
    check((await styleOf(name)) === duplicateStyle, `${name} is styled like the other buttons`)
  }
  await rail.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await rail.screenshot({ path: join(shots, 'inspector-actions.png') })
  await axe(p, 'inspector actions')
  await p.getByRole('button', { name: /^Page setup/ }).click()
  const select = p.getByRole('dialog', { name: 'Page setup' }).locator('select').first()
  const padRight = await select.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))
  check(padRight >= 24, `the page-size select leaves room for its arrow (${padRight}px)`)
  await p.screenshot({ path: join(shots, 'page-setup-select.png') })
  await p.keyboard.press('Escape')
  // Switch without transitions: axe must see the settled colours, not a
  // frame mid-fade (CI's slower runner caught one).
  await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await p.evaluate(async () => {
    document.documentElement.dataset.theme = 'dark'
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await axe(p, 'inspector actions, dark')
  await ctx.close()
}

// 22. Several pages at once (#65): range, toggle, all; bulk rotate and remove
//     as one undo step each; dragging or keyboard-moving one moves them all.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const files = ['quad-landscape.jpg', 'quad-portrait.jpg', 'quad-exif6.jpg', 'doc-photo.jpg']
  await p.setInputFiles(
    '[data-testid="file-input"]',
    files.map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]')
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  const selectedCards = () =>
    p.$$eval('ol[aria-label] > li [data-page-select]', (els) =>
      els.flatMap((el, i) => (el.getAttribute('aria-current') === 'true' ? [i + 1] : [])),
    )
  const says = () => p.locator('#status').textContent()
  const rail = p.locator('aside[aria-label="Selected page"]')

  await card(2).click()
  await card(4).click({ modifiers: ['Shift'] })
  check(
    JSON.stringify(await selectedCards()) === '[2,3,4]',
    'Shift-click selects a range',
    JSON.stringify(await selectedCards()),
  )
  check((await says()) === '3 pages selected.', 'the range is announced', (await says()) ?? '')
  await card(3).click({ modifiers: ['ControlOrMeta'] })
  check(
    JSON.stringify(await selectedCards()) === '[2,4]',
    'Ctrl/⌘-click takes one page out',
    JSON.stringify(await selectedCards()),
  )
  // From the keyboard: Ctrl+Enter on a page adds it, like Ctrl-click.
  await card(1).focus()
  await p.keyboard.press('ControlOrMeta+Enter')
  check(
    JSON.stringify(await selectedCards()) === '[1,2,4]',
    'Ctrl+Enter on a page adds it to the selection',
    JSON.stringify(await selectedCards()),
  )
  await p.keyboard.press('Escape')
  check((await selectedCards()).length === 1, 'Escape clears the selection to one page')
  await p.keyboard.press('ControlOrMeta+a')
  check((await selectedCards()).length === 4, '⌘A / Ctrl+A selects every page')
  check((await says()) === 'All 4 pages selected.', 'select all is announced')
  await rail.screenshot({ path: join(shots, 'group-inspector.png') })
  await axe(p, 'several pages selected')

  // Bulk rotate pages 1 and 3, then remove them; one undo step each.
  await card(1).click()
  await card(3).click({ modifiers: ['ControlOrMeta'] })
  const turned = async () =>
    p.$$eval('ol[aria-label] > li [data-page-select] img', (imgs) =>
      imgs.map((img) => getComputedStyle(img).transform),
    )
  const before = await turned()
  await rail.getByRole('button', { name: 'Right', exact: true }).click()
  const after = await turned()
  check(
    after[0] !== before[0] && after[2] !== before[2] && after[1] === before[1],
    'bulk rotate turns the selected pages only',
    JSON.stringify(after),
  )
  await rail.getByRole('button', { name: 'Remove', exact: true }).click()
  await p.waitForSelector('ol[aria-label="2 pages"]')
  check(
    JSON.stringify(await pageNames(p)) === JSON.stringify([files[1], files[3]]),
    'bulk remove takes out the selected pages',
    (await pageNames(p)).join(', '),
  )
  await p.keyboard.press('ControlOrMeta+z')
  await p.waitForSelector('ol[aria-label="4 pages"]')
  check(
    JSON.stringify(await turned()) === JSON.stringify(after),
    'one undo brings both pages back, still turned',
  )
  await p.keyboard.press('ControlOrMeta+z')
  check(
    JSON.stringify(await turned()) === JSON.stringify(before),
    'a second undo unturns both pages',
  )

  // Drag page 1 of a selection {1, 2} past page 4: both go to the end.
  await card(1).click()
  await card(2).click({ modifiers: ['Shift'] })
  const handle = (n) => p.getByRole('button', { name: `Reorder page ${n}` })
  await card(1).hover()
  const from = await handle(1).boundingBox()
  const to = await card(4).boundingBox()
  if (from && to) {
    await p.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await p.mouse.down()
    await p.mouse.move(from.x + 30, from.y + 10, { steps: 5 })
    await p.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, { steps: 20 })
    await p.waitForTimeout(300)
    await p.mouse.up()
    await p.waitForTimeout(500)
  }
  check(
    JSON.stringify(await pageNames(p)) === JSON.stringify([files[2], files[3], files[0], files[1]]),
    'dragging one selected page moves the whole selection',
    (await pageNames(p)).join(', '),
  )
  check(
    JSON.stringify(await selectedCards()) === '[3,4]',
    'the selection moves with them',
    JSON.stringify(await selectedCards()),
  )
  // Keyboard reorder of the group: pick up page 3, one place left, drop.
  await handle(3).focus()
  await p.keyboard.press('Space')
  await p.waitForTimeout(150)
  await p.keyboard.press('ArrowLeft')
  await p.waitForTimeout(400)
  await p.keyboard.press('Space')
  await p.waitForTimeout(500)
  check(
    JSON.stringify(await pageNames(p)) === JSON.stringify([files[2], files[0], files[1], files[3]]),
    'keyboard reorder moves the whole selection',
    (await pageNames(p)).join(', '),
  )
  check(
    (await selectedCards()).length === 2,
    'Escape-free drop leaves the selection in place',
    JSON.stringify(await selectedCards()),
  )
  await ctx.close()
}

// 24. Several pictures on one page (#76): 4 per page and ID card, preview ≡ PDF.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-landscape.jpg', 'quad-exif6.jpg', 'quad-portrait.jpg', 'quad-rotate90.pdf'].map((f) =>
      join(fixtures, f),
    ),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]', { timeout: 20_000 })
  const panel = p.locator('aside[aria-label="Selected page"]')
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  /** Exports, renders page `n` and compares it with the inspector's sheet. */
  const matchesExport = async (label, n = 1) => {
    const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
    const out = join(mkdtempSync(join(tmpdir(), 'collated-verify-sheet-')), 'sheet.pdf')
    await dl.saveAs(out)
    if (!hasPoppler) return out
    const prefix = out.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '72',
      '-f',
      String(n),
      '-l',
      String(n),
      '-singlefile',
      out,
      prefix,
    ])
    const rendered = readFileSync(`${prefix}.png`).toString('base64')
    const preview = (await panel.locator('.sheet').first().screenshot(sheetShot)).toString('base64')
    writeFileSync(join(shots, `sheet-${label}-pdf.png`), Buffer.from(rendered, 'base64'))
    writeFileSync(join(shots, `sheet-${label}-preview.png`), Buffer.from(preview, 'base64'))
    const diff = await compareImages(rendered, preview)
    check(
      diff.farShare < 0.03,
      `${label}: preview matches the export (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
    return out
  }

  await card(1).click()
  await p.keyboard.press('Control+a')
  await panel.getByRole('button', { name: '4 per page' }).click()
  await p.waitForSelector('ol[aria-label="1 page"]')
  check(
    (await pageNames(p))[0] ===
      '4 per page: quad-landscape.jpg, quad-exif6.jpg, quad-portrait.jpg, quad-rotate90.pdf',
    'four pages combine onto one',
    (await pageNames(p)).join(' | '),
  )
  await p.screenshot({ path: join(shots, 'sheet-4up.png') })
  await axe(p, 'combined page')
  const fourUp = await PDFDocument.load(readFileSync(await matchesExport('4 per page')))
  check(fourUp.getPageCount() === 1, '4 per page exports as one page')

  await panel.getByRole('button', { name: 'Split' }).click()
  await p.waitForSelector('ol[aria-label="4 pages"]')
  await card(1).click()
  await card(2).click({ modifiers: ['Shift'] })
  await panel.getByRole('button', { name: 'ID card' }).click()
  await p.waitForSelector('ol[aria-label="3 pages"]')
  const idPdf = await PDFDocument.load(readFileSync(await matchesExport('ID card')))
  const { width, height } = idPdf.getPage(0).getSize()
  check(
    idPdf.getPageCount() === 3 && width === 612 && height === 792,
    'the ID card page is a Letter page (en-US) among the others',
    `${idPdf.getPageCount()} pages, ${width} × ${height}`,
  )
  await p.screenshot({ path: join(shots, 'sheet-id-card.png') })
  await ctx.close()
}

// 23. Work survives a reload (#74): restore with undo, bytes once, cleared on request.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  check(
    (await p.getByRole('region', { name: 'Restore your last document?' }).count()) === 0,
    'a first visit offers nothing to restore',
  )
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'quad-exif6.jpg'),
    join(fixtures, 'quad-3pages.pdf'),
  ])
  await p.waitForSelector('ol[aria-label="5 pages"]', { timeout: 10_000 })
  await setTitle(p, 'Kept')
  await p.getByRole('button', { name: 'Remove page 1' }).click()
  await p.waitForSelector('ol[aria-label="4 pages"]')
  await exportMenu(p).click()
  await p.getByLabel('Password to open').fill('secret-pw')
  await p.keyboard.press('Escape')
  const before = await pageNames(p)
  // Saved shortly after each change.
  await p.waitForTimeout(1000)
  const stored = await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('collated-work')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction(['bytes', 'thumbs', 'doc'], 'readonly')
          const n = (store) =>
            new Promise((r) => {
              const q = tx.objectStore(store).count()
              q.onsuccess = () => r(q.result)
            })
          const doc = new Promise((r) => {
            const q = tx.objectStore('doc').get('current')
            q.onsuccess = () => r(JSON.stringify(q.result))
          })
          Promise.all([n('bytes'), n('thumbs'), doc]).then(([bytes, thumbs, json]) => {
            open.result.close()
            resolve({ bytes, thumbs, json })
          })
        }
      }),
  )
  check(
    stored.bytes === 3 && stored.thumbs === 5,
    'bytes stored once per file (3 files, 5 pages), thumbnails once per page source',
    `${stored.bytes} bytes, ${stored.thumbs} thumbs`,
  )
  check(!stored.json.includes('secret-pw'), 'the password is never stored')

  await p.reload({ waitUntil: 'networkidle' })
  const offer = p.getByRole('region', { name: 'Restore your last document?' })
  await offer.waitFor()
  check(
    /4 pages, saved on this device today at/.test((await offer.textContent()) ?? ''),
    'after a reload, the last document is offered',
  )
  await p.screenshot({ path: join(shots, 'restore-offer.png') })
  await axe(p, 'restore offer')
  await offer.getByRole('button', { name: 'Restore' }).click()
  await p.waitForSelector('ol[aria-label="4 pages"]')
  check(
    JSON.stringify(await pageNames(p)) === JSON.stringify(before),
    'Restore brings the pages back in order',
    JSON.stringify(await pageNames(p)),
  )
  const thumbsLoad = await p.$$eval('ol img', (imgs) =>
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? img.naturalWidth > 0
          : new Promise((r) => {
              img.onload = () => r(true)
              img.onerror = () => r(false)
            }),
      ),
    ),
  )
  check(thumbsLoad.length === 4 && thumbsLoad.every(Boolean), 'restored previews load')
  await exportMenu(p).click()
  check(
    (await p.getByLabel('Password to open').inputValue()) === '',
    'the password does not come back',
  )
  await p.keyboard.press('Escape')
  await p.keyboard.press('Control+z')
  await p.waitForSelector('ol[aria-label="5 pages"]')
  ok('undo works across the reload: the removed page comes back')
  await p.keyboard.press('Control+Shift+z')
  await p.waitForSelector('ol[aria-label="4 pages"]')
  const [download] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const restoredPdf = await PDFDocument.load(readFileSync(await download.path()))
  check(
    restoredPdf.getPageCount() === 4 && download.suggestedFilename() === 'Kept.pdf',
    'a restored document exports from the bytes kept on the device',
    `${restoredPdf.getPageCount()} pages, ${download.suggestedFilename()}`,
  )

  // Discard deletes it; the next visit offers nothing.
  await p.waitForTimeout(1000)
  await p.reload({ waitUntil: 'networkidle' })
  await p
    .getByRole('region', { name: 'Restore your last document?' })
    .getByRole('button', { name: 'Discard' })
    .click()
  // Deleting is asynchronous: wait for IndexedDB to say it's gone, as a person
  // reopening the tab later would find it.
  const gone = await p
    .waitForFunction(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('collated-work')
          open.onsuccess = () => {
            const q = open.result.transaction('doc', 'readonly').objectStore('doc').count()
            q.onsuccess = () => {
              open.result.close()
              resolve(q.result === 0)
            }
          }
        }),
      null,
      { timeout: 5000 },
    )
    .then(
      () => true,
      () => false,
    )
  check(gone, 'Discard deletes the stored document')
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(300)
  check(
    (await p.getByRole('region', { name: 'Restore your last document?' }).count()) === 0,
    'Discard deletes the saved copy',
  )

  // The switch in More: off deletes it and keeps nothing.
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await p.waitForTimeout(1000)
  await p.getByRole('button', { name: 'More' }).click()
  const keep = p
    .getByRole('dialog', { name: 'More' })
    .getByRole('switch', { name: 'Keep work after a reload' })
  check((await keep.getAttribute('aria-checked')) === 'true', 'Keep work is on by default')
  await p.screenshot({ path: join(shots, 'keep-work-switch.png') })
  await axe(p, 'More menu with the Keep work switch')
  await keep.click()
  await p.waitForTimeout(500)
  await p.reload({ waitUntil: 'networkidle' })
  await p.waitForTimeout(300)
  check(
    (await p.getByRole('region', { name: 'Restore your last document?' }).count()) === 0,
    'turning Keep work off deletes the copy',
  )
  await ctx.close()
}

// 25. Blank pages (#68): flagged from real scans, removed together, undone. --
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  // A printed page, the back of a sheet (show-through, punch holes, dust, lid
  // shadow), a sparse page of four lines, and that back again.
  await p.setInputFiles(
    '[data-testid="file-input"]',
    [
      'scan-letter-300dpi.jpg',
      'scan-blank-back.jpg',
      'text-page-sideways.jpg',
      'scan-blank-back.jpg',
    ].map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="4 pages"]')
  const remove = p.getByRole('button', { name: 'Remove 2 blank pages' })
  await remove.waitFor({ timeout: 10_000 }).catch(() => undefined)
  const flagged = await p
    .locator('[data-page-select]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')?.endsWith('looks blank')))
  check(
    JSON.stringify(flagged) === '[false,true,false,true]',
    'only the blank backs are flagged (show-through, punch holes and dust ignored)',
    JSON.stringify(flagged),
  )
  check(
    (await p.getByText('Looks blank', { exact: true }).count()) === 2,
    'each blank page carries a visible badge',
  )
  await p.waitForFunction(() =>
    /2 pages look blank/.test(document.getElementById('status')?.textContent ?? ''),
  )
  check(true, 'the blank pages are announced')
  await axe(p, 'blank pages flagged')
  await p.screenshot({ path: join(shots, 'blank-pages.png') })
  await remove.click()
  await p.waitForSelector('ol[aria-label="2 pages"]')
  check(
    JSON.stringify(await pageNames(p)) ===
      JSON.stringify(['scan-letter-300dpi.jpg', 'text-page-sideways.jpg']),
    'Remove blank pages takes out only the flagged pages',
    (await pageNames(p)).join(', '),
  )
  await p.getByRole('button', { name: /^Undo/ }).click()
  await p.waitForSelector('ol[aria-label="4 pages"]')
  check(true, 'one undo brings both blank pages back')
  await ctx.close()
}

// 26. Auto-rotate (#70): reads the text, turns the sideways page, leaves a picture.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-portrait.jpg'),
    join(fixtures, 'text-page-sideways.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  await p.getByRole('button', { name: 'More' }).click()
  const started = Date.now()
  await p
    .getByRole('dialog', { name: 'More' })
    .getByRole('button', { name: 'Auto-rotate pages' })
    .click()
  const expected =
    'Turned page 2 the right way up. 1 page had too little text to tell and was left as it is.'
  const said = await p
    .waitForFunction(
      (text) => document.getElementById('status')?.textContent?.includes(text),
      expected,
      { timeout: 120_000 },
    )
    .then(
      () => true,
      () => false,
    )
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  check(
    said,
    `Auto-rotate turns the sideways text page and leaves the picture (first run with downloads: ${seconds} s)`,
    `status: "${await p.locator('#status').textContent()}"`,
  )
  await p.screenshot({ path: join(shots, 'auto-rotated.png'), fullPage: true })
  // The page now carries a turn, which Reset (and one undo) takes off.
  await p.getByRole('button', { name: 'Page 2: text-page-sideways.jpg' }).click()
  const panel = p.getByRole('complementary', { name: 'Selected page' })
  check(
    (await panel.getByRole('button', { name: 'Reset' }).getAttribute('aria-disabled')) === null,
    'the auto-rotated page shows a change to reset',
  )
  await p.keyboard.press('Control+z')
  await p.waitForTimeout(200)
  check(
    (await panel.getByRole('button', { name: 'Reset' }).getAttribute('aria-disabled')) === 'true',
    'one undo takes the auto-rotate back',
  )
  await ctx.close()
}

// 27. Take photo on a phone (#72): opens the camera, one shot after another,
//     HEIC included; not offered with a mouse.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  /** Presses Take photo and "shoots" `file` through the chooser it opens. */
  const shoot = async (file) => {
    const [chooser] = await Promise.all([
      p.waitForEvent('filechooser'),
      p.getByRole('button', { name: 'Take photo' }).click(),
    ])
    check(!chooser.isMultiple(), 'the camera takes one shot at a time')
    const capture = await chooser.element().getAttribute('capture')
    check(capture === 'environment', 'Take photo asks for the back camera', String(capture))
    await chooser.setFiles(join(fixtures, file))
  }
  await shoot('quad-exif6.jpg')
  await p.waitForSelector('ol[aria-label="1 page"]', { timeout: 20_000 })
  await shoot('quad-landscape.heic')
  await p.waitForSelector('ol[aria-label="2 pages"]', { timeout: 30_000 })
  const labels = await p
    .locator('ol[aria-label="2 pages"] [data-page-select]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  check(
    /^Page 1: Photo \d\d\.\d\d\.\d\d\.jpg$/.test(labels[0] ?? '') &&
      /^Page 2: Photo \d\d\.\d\d\.\d\d\.heic$/.test(labels[1] ?? ''),
    'shots go after the last page, named by when they were taken',
    labels.join(' | '),
  )
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 390)
  check(overflow <= 0, 'Take photo fits the phone toolbar', `${overflow}px`)
  await p.waitForTimeout(500) // the HEIC thumbnail
  await p.screenshot({ path: join(shots, 'take-photo.png') })
  await axe(p, 'phone with Take photo')
  await phone.close()

  const { context: desk, page: d } = await open({ viewport: { width: 1440, height: 1000 } })
  await d.goto(URL_ROOT, { waitUntil: 'networkidle' })
  check(
    (await d.getByRole('button', { name: 'Take photo' }).count()) === 0,
    'no Take photo with a mouse',
  )
  await desk.close()
}

// 28. The installed app (#73): installable, offline after the first visit
//     (HEIC once it has been used), and files shared to it become pages.
{
  // A profile on disk: Chromium never offers to install from an incognito
  // window, and every context Playwright makes otherwise is one.
  const ctx = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'collated-verify-profile-')),
    {
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      acceptDownloads: true,
      viewport: { width: 1280, height: 800 },
    },
  )
  const p = await watch(ctx, ctx.pages()[0] ?? (await ctx.newPage()))
  const input = '[data-testid="file-input"]'
  await p.goto(URL_ROOT, { waitUntil: 'load' })
  const cdp = await ctx.newCDPSession(p)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  check(
    installabilityErrors.length === 0,
    'Chromium finds Collated installable (manifest, icons, service worker)',
    JSON.stringify(installabilityErrors),
  )
  const { url: manifestUrl, errors: manifestErrors } = await cdp.send('Page.getAppManifest')
  check(
    manifestUrl.endsWith('/manifest.webmanifest') && manifestErrors.length === 0,
    'the manifest parses without errors',
    JSON.stringify(manifestErrors),
  )
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  })
  ok('the service worker takes over the page once installed')
  // HEIC decoding is fetched on first use, and kept from then on.
  await p.setInputFiles(input, [join(fixtures, 'quad-landscape.heic')])
  await p.waitForSelector('ol[aria-label="1 page"]', { timeout: 20_000 })
  // Offline: no network at all, and the server gone too.
  serverDown = true
  await ctx.setOffline(true)
  try {
    await p.reload({ waitUntil: 'load' })
    await p.waitForSelector(input, { state: 'attached', timeout: 15_000 })
    ok('the app loads with no connection')
    // Files added instead of restoring start a new document (#74).
    await p.setInputFiles(input, [
      join(fixtures, 'quad-3pages.pdf'),
      join(fixtures, 'quad-landscape.heic'),
      join(fixtures, 'quad-landscape.jpg'),
    ])
    await p.waitForSelector('ol[aria-label="5 pages"]', { timeout: 20_000 })
    ok('offline, it reads a PDF (pdf.js), a HEIC photo (used once before) and a JPEG')
    const [saved] = await Promise.all([
      p.waitForEvent('download', { timeout: 20_000 }),
      exportNow(p),
    ])
    const pdf = await PDFDocument.load(readFileSync(await saved.path()))
    check(pdf.getPageCount() === 5, 'offline, it exports the PDF', String(pdf.getPageCount()))
    const help = await ctx.newPage()
    await help.goto(`${URL_ROOT}docs/keyboard/`)
    check(/keyboard/i.test(await help.title()), 'offline, the docs pages open', await help.title())
    await help.close()
  } finally {
    await ctx.setOffline(false)
    serverDown = false
  }

  // A share from another app: the system opens a window that posts the files
  // to /share, which only the service worker answers. Played here by a form
  // on a blank page (Collated's own CSP rightly forbids its pages to post).
  const sheet = await watch(ctx, await ctx.newPage())
  await sheet.setContent(
    `<form method="post" action="${URL_ROOT}share" enctype="multipart/form-data">` +
      '<input type="file" name="files" multiple></form>',
  )
  const gallery = join(
    mkdtempSync(join(tmpdir(), 'collated-verify-share-')),
    'From the gallery.jpg',
  )
  const email = join(dirname(gallery), 'Lease from email.pdf')
  writeFileSync(gallery, readFileSync(join(fixtures, 'quad-portrait.jpg')))
  writeFileSync(email, readFileSync(join(fixtures, 'quad-3pages.pdf')))
  await sheet.setInputFiles('input', [gallery, email])
  await Promise.all([
    sheet.waitForURL(`${URL_ROOT}**`),
    sheet.evaluate(() => document.forms[0].submit()),
  ])
  // Nothing goes in until the person says they shared it: any site can post
  // to /share. Then the document there (kept since the offline export) is
  // restored and the shared files are added to it.
  const ask = sheet.getByRole('dialog', { name: 'Add 2 files shared with Collated?' })
  await ask.waitFor({ timeout: 20_000 })
  ok('the service worker takes the shared files and the app asks before adding them')
  check(
    (await ask.textContent()).includes('From the gallery.jpgLease from email.pdf'),
    'the question names the shared files',
  )
  check(
    await ask
      .getByRole('button', { name: 'Don’t add' })
      .evaluate((el) => el === document.activeElement),
    'it opens on Don’t add',
  )
  await axe(sheet, 'shared files question')
  await ask.getByRole('button', { name: 'Add 2 files' }).click()
  await sheet.waitForSelector('ol[aria-label="9 pages"]', { timeout: 20_000 })
  const names = await pageNames(sheet)
  check(
    names[5] === 'From the gallery.jpg' && names.at(-1) === 'Lease from email · p3',
    'shared files join the kept document, in the order shared, names intact',
    names.join(', '),
  )
  check(!sheet.url().includes('share='), 'the share is dropped from the address', sheet.url())
  const left = await sheet.evaluate(
    async () => (await (await caches.open('collated-share-inbox')).keys()).length,
  )
  check(left === 0, 'the inbox is empty once the app has the files', String(left))
  await sheet.screenshot({ path: join(shots, 'shared-files.png') })
  await ctx.close()
}

// 29. Bookmarks (#75): a section follows its page; files under it; poppler reads them.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-landscape.jpg', 'quad-portrait.jpg', 'quad-3pages.pdf'].map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="5 pages"]', { timeout: 20_000 })
  const panel = p.locator('aside[aria-label="Selected page"]')
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  await card(2).click()
  await panel.getByLabel('Section starts here').fill('Receipts')
  await panel.getByLabel('Section starts here').blur()
  // The section moves with its page: page 2 goes to the end.
  for (let i = 0; i < 3; i++) await panel.getByRole('button', { name: 'Move page later' }).click()
  check(
    /starts section Receipts/.test((await card(5).getAttribute('aria-label')) ?? ''),
    'the section moves with its page',
    (await card(5).getAttribute('aria-label')) ?? '',
  )
  await p.screenshot({ path: join(shots, 'bookmarks-section.png') })
  await axe(p, 'section field')
  await exportMenu(p).click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.getByRole('checkbox', { name: 'Bookmark each imported file' }).check()
  await p.keyboard.press('Escape')
  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const out = join(mkdtempSync(join(tmpdir(), 'collated-verify-bookmarks-')), 'bookmarks.pdf')
  await dl.saveAs(out)
  if (hasPoppler) {
    const xml = execFileSync('pdftohtml', ['-xml', '-i', '-stdout', '-q', out, 'x']).toString()
    const items = [...xml.matchAll(/<item page="(\d+)">([^<]*)<\/item>/g)].map(
      ([, n, t]) => `${t}@${n}`,
    )
    check(
      JSON.stringify(items) ===
        JSON.stringify(['quad-landscape@1', 'quad-3pages@2', 'Receipts@5', 'quad-portrait@5']),
      'poppler reads the files and the section, each at its page',
      items.join(', '),
    )
  }
  await ctx.close()
}

// 30. Black out (#77): drawn and keyboard boxes; what's under them is gone
//     from the file, not covered; preview ≡ PDF; OCR leaves them out.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  // A Letter page with real text: a number to hide and a line to keep.
  const statement = await PDFDocument.create()
  const sheetPage = statement.addPage([612, 792])
  const font = await statement.embedFont(StandardFonts.Helvetica)
  sheetPage.drawText('ACCOUNT 12345678', { x: 72, y: 700, size: 18, font })
  sheetPage.drawText('KEEP THIS LINE', { x: 72, y: 400, size: 28, font })
  const dir = mkdtempSync(join(tmpdir(), 'collated-verify-redact-'))
  const statementPath = join(dir, 'statement.pdf')
  writeFileSync(statementPath, await statement.save())
  await p.setInputFiles('[data-testid="file-input"]', [
    statementPath,
    join(fixtures, 'quad-landscape.png'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]', { timeout: 20_000 })
  const panel = p.locator('aside[aria-label="Selected page"]')
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  // The number's box, as fractions of the page (y down).
  const SECRET = { x0: 60 / 612, y0: 64 / 792, x1: 300 / 612, y1: 100 / 792 }

  // Page 1: drag a box over the number.
  await card(1).click()
  await panel.getByRole('button', { name: 'Black out part of the page…' }).click()
  const editor = p.getByRole('dialog', { name: 'Black out' })
  await editor.waitFor()
  const stage = editor.locator('.cursor-crosshair')
  const at = async (fx, fy) => {
    const box = await stage.boundingBox()
    return [box.x + fx * box.width, box.y + fy * box.height]
  }
  await p.mouse.move(...(await at(SECRET.x0, SECRET.y0)))
  await p.mouse.down()
  await p.mouse.move(...(await at((SECRET.x0 + SECRET.x1) / 2, SECRET.y1)), { steps: 4 })
  await p.mouse.move(...(await at(SECRET.x1, SECRET.y1)), { steps: 4 })
  await p.mouse.up()
  check(
    (await editor.getByRole('button', { name: 'Box 1', exact: true }).count()) === 1,
    'dragging on the image draws a box',
  )
  await p.screenshot({ path: join(shots, 'redact-editor.png') })
  await axe(p, 'black out editor')
  await editor.getByRole('button', { name: 'Apply' }).click()
  await editor.waitFor({ state: 'hidden' })
  check(
    (await panel.getByRole('button', { name: 'Edit 1 blacked-out area…' }).count()) === 1,
    'the page has one blacked-out area',
  )

  // Page 2: a box from the keyboard alone.
  await card(2).click()
  await panel.getByRole('button', { name: 'Black out part of the page…' }).focus()
  await p.keyboard.press('Enter')
  await editor.waitFor()
  await editor.getByRole('button', { name: 'Add a box' }).focus()
  await p.keyboard.press('Enter')
  const added = editor.getByRole('button', { name: 'Box 1', exact: true })
  check(
    await added.evaluate((el) => el === document.activeElement),
    'Add a box focuses the new box',
  )
  await p.keyboard.press('Shift+ArrowUp')
  await editor.getByRole('button', { name: 'Apply' }).click()
  await editor.waitFor({ state: 'hidden' })

  const exported = async (label) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120_000 }), exportNow(p)])
    const out = join(dir, `${label}.pdf`)
    await dl.saveAs(out)
    return out
  }
  const out = await exported('redacted')
  if (hasPoppler) {
    const text = execFileSync('pdftotext', [out, '-']).toString()
    check(
      !text.includes('ACCOUNT') && !text.includes('12345678'),
      'nothing under the box is left as text',
      text.trim(),
    )
    const fonts = execFileSync('pdffonts', [out]).toString().trim().split('\n').slice(2)
    check(
      fonts.length === 0,
      'the blacked-out PDF page is exported as a picture, no fonts',
      fonts.join('\n'),
    )
    const render = (n) => {
      const prefix = join(dir, `page-${n}`)
      execFileSync('pdftoppm', [
        '-png',
        '-r',
        '72',
        '-f',
        String(n),
        '-l',
        String(n),
        '-singlefile',
        out,
        prefix,
      ])
      return readFileSync(`${prefix}.png`).toString('base64')
    }
    /** Mean brightness (0–255) of a rectangle of a PNG, in fractions. */
    const meanOf = (png, r) =>
      p.evaluate(
        async ([src, r]) => {
          const img = new Image()
          img.src = `data:image/png;base64,${src}`
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const g = c.getContext('2d')
          g.drawImage(img, 0, 0)
          const x = Math.ceil(r.x0 * img.width) + 1
          const y = Math.ceil(r.y0 * img.height) + 1
          const w = Math.floor((r.x1 - r.x0) * img.width) - 2
          const h = Math.floor((r.y1 - r.y0) * img.height) - 2
          const { data } = g.getImageData(x, y, w, h)
          let sum = 0
          for (let i = 0; i < data.length; i += 4) sum += (data[i] + data[i + 1] + data[i + 2]) / 3
          return sum / (data.length / 4)
        },
        [png, r],
      )
    const page1 = render(1)
    const dark = await meanOf(page1, SECRET)
    check(dark < 10, `the PDF page's box is solid black (mean ${dark.toFixed(1)})`)
    await card(1).click()
    const diff = await compareImages(
      page1,
      (await panel.locator('.sheet').first().screenshot(sheetShot)).toString('base64'),
    )
    check(
      diff.farShare < 0.03,
      `the blacked-out page matches its preview (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
    // The keyboard box: 40% × 8% in the middle, nudged up 5%.
    const image = await meanOf(render(2), { x0: 0.3, y0: 0.41, x1: 0.7, y1: 0.49 })
    check(image < 10, `the image page's box is burned into its pixels (mean ${image.toFixed(1)})`)
  }

  // With OCR on, the rest of the drawn page is searchable again; the number isn't.
  await exportMenu(p).click()
  const options = p.getByRole('dialog', { name: 'Export options' })
  await options.getByRole('checkbox', { name: 'Make text searchable (OCR)' }).check()
  await p.keyboard.press('Escape')
  const ocrOut = await exported('redacted-ocr')
  if (hasPoppler) {
    const text = execFileSync('pdftotext', ['-f', '1', '-l', '1', ocrOut, '-']).toString()
    check(
      /KEEP/.test(text) && !text.includes('12345678') && !text.includes('ACCOUNT'),
      'with OCR the page is searchable except under the box',
      text.trim(),
    )
  }
  await ctx.close()
}

// 31. Watermark (#78): on the pages as previewed, as text or burned in. ------
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'quad-3pages.pdf'),
  ])
  await p.waitForSelector('ol[aria-label="4 pages"]', { timeout: 20_000 })
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  const options = dialog.getByRole('group', { name: 'Watermark options' })
  /** Opens the export options, changes the watermark, closes them. */
  const watermark = async (act) => {
    await exportMenu(p).click()
    await act()
    await p.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }
  await watermark(async () => {
    await dialog.getByRole('checkbox', { name: 'Watermark' }).check()
    await options.getByLabel('Text').fill('Copy for Verify only')
    await options.getByLabel('Size').selectOption('large')
    await options.getByLabel('Colour').fill('#c00000')
    await options.getByLabel('Opacity').fill('80')
    await axe(p, 'export options with a watermark')
    await p.screenshot({ path: join(shots, 'watermark-options.png') })
  })
  check(
    (await p.locator('ol[aria-label] [data-watermark]').count()) === 4,
    'every page previews the watermark',
  )
  await p.getByRole('button', { name: 'Page 1: quad-landscape.jpg' }).click()
  const panel = p.locator('aside[aria-label="Selected page"]')
  await p.screenshot({ path: join(shots, 'watermark.png') })

  /** Exports, then compares page 1's render with the inspector's sheet. */
  const exported = async (label) => {
    const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
    const out = join(mkdtempSync(join(tmpdir(), 'collated-verify-watermark-')), 'out.pdf')
    await dl.saveAs(out)
    if (!hasPoppler) return out
    const prefix = out.replace(/\.pdf$/, '')
    execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', '-singlefile', out, prefix])
    const rendered = readFileSync(`${prefix}.png`).toString('base64')
    const preview = (await panel.locator('.sheet').first().screenshot(sheetShot)).toString('base64')
    writeFileSync(join(shots, `watermark-${label}-pdf.png`), Buffer.from(rendered, 'base64'))
    writeFileSync(join(shots, `watermark-${label}-preview.png`), Buffer.from(preview, 'base64'))
    const diff = await compareImages(rendered, preview)
    check(
      diff.farShare < 0.03,
      `watermark ${label}: preview matches the export (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
    )
    return out
  }
  const textOf = (path, n) =>
    execFileSync('pdftotext', ['-f', String(n), '-l', String(n), path, '-']).toString()
  const imagesOn = (path, n) =>
    execFileSync('pdfimages', ['-f', String(n), '-l', String(n), '-list', path])
      .toString()
      .split('\n')
      .slice(2)
      .filter(Boolean).length

  await exported('across')

  await watermark(async () => {
    await options.getByLabel('Position').selectOption('footer')
  })
  const footer = await exported('foot')
  if (hasPoppler) {
    // Where the preview draws it vs where the PDF has it.
    const previewBox = await panel
      .locator('.sheet')
      .first()
      .evaluate((sheet) => {
        const s = sheet.getBoundingClientRect()
        const r = sheet.querySelector('[data-watermark]')?.getBoundingClientRect()
        return r
          ? {
              x: ((r.left + r.right) / 2 - s.left) / s.width,
              y: (r.bottom - s.top) / s.height,
            }
          : null
      })
    const xml = execFileSync('pdftotext', ['-f', '1', '-l', '1', '-bbox', footer, '-']).toString()
    const size = /<page width="([\d.]+)" height="([\d.]+)"/.exec(xml)
    const words = [
      ...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">/g),
    ]
    if (size && words.length && previewBox) {
      const x0 = Math.min(...words.map((w) => Number(w[1])))
      const x1 = Math.max(...words.map((w) => Number(w[3])))
      const y1 = Math.max(...words.map((w) => Number(w[4])))
      const off = Math.max(
        Math.abs((x0 + x1) / 2 / Number(size[1]) - previewBox.x),
        Math.abs(y1 / Number(size[2]) - previewBox.y),
      )
      check(
        off < 0.01,
        `the watermark sits where the PDF puts it (within ${(off * 100).toFixed(2)}% of the page)`,
      )
    } else fails.push('watermark not found in the PDF text')
    check(
      textOf(footer, 1).includes('Copy for Verify only') &&
        textOf(footer, 2).includes('Copy for Verify only'),
      'the watermark is text on image and PDF pages',
    )
  }

  await watermark(async () => {
    await options.getByRole('checkbox', { name: 'Burn into image pages' }).check()
  })
  const burned = await exported('foot-burned')
  if (hasPoppler) {
    check(
      !textOf(burned, 1).includes('Verify') && imagesOn(burned, 1) === 1,
      'burned in, the image page is one picture with no watermark text',
      textOf(burned, 1),
    )
    check(
      textOf(burned, 2).includes('Copy for Verify only'),
      'burned in, a PDF page keeps the watermark as text',
    )
  }
  await watermark(async () => {
    await options.getByLabel('Position').selectOption('diagonal')
  })
  await exported('across-burned')

  // On the selected page only.
  await watermark(async () => {
    await options.getByRole('radio', { name: 'Selected pages (1)' }).check()
  })
  check(
    (await p.locator('ol[aria-label] [data-watermark]').count()) === 1,
    'on the selected page only, one page previews it',
  )
  await axe(p, 'a watermark on one page')
  await ctx.close()
}

// 32. OCR in French (#79): the picker starts at the browser's language, its
// data is fetched from our origin, and accented words come back out.
{
  const { context: ctx, page: p } = await open({
    viewport: { width: 1440, height: 1000 },
    locale: 'fr-FR',
  })
  const langFetches = []
  p.on('request', (r) => {
    if (r.url().includes('/ocr/lang/')) langFetches.push(new URL(r.url()).pathname)
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'text-page-fr.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await exportMenu(p).click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.getByRole('checkbox', { name: 'Make text searchable (OCR)' }).check()
  const picker = dialog.getByLabel('Language of the text')
  check(
    (await picker.inputValue()) === 'fra',
    'the OCR language starts at the browser’s (fr-FR → French)',
    await picker.inputValue(),
  )
  await axe(p, 'OCR language picker')
  const [d] = await Promise.all([
    p.waitForEvent('download', { timeout: 120_000 }),
    dialog.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-ocr-fr-')), 'fr.pdf')
  await d.saveAs(path)
  check(
    JSON.stringify(langFetches) === JSON.stringify(['/ocr/lang/fra.traineddata.gz']),
    'only the French data is fetched, from our own origin',
    langFetches.join(', '),
  )
  const text = (() => {
    try {
      return execFileSync('pdftotext', [path, '-']).toString().replace(/\s+/g, ' ')
    } catch {
      return null
    }
  })()
  if (text !== null) {
    const expected = [
      'Facture numéro 4417',
      'régler en août',
      'cœur',
      'élève',
      'très',
      'garçon',
      'Déjà payé',
      'Reçu',
      'crème brûlée',
      'thé glacé',
    ]
    const missing = expected.filter((phrase) => !text.includes(phrase))
    check(
      missing.length === 0,
      'French OCR keeps the accents: pdftotext reads them back',
      `missing: ${missing.join(' | ')} in "${text.slice(0, 200)}"`,
    )
  }
  // Remembered for next time, even if the browser's language changes.
  await p.reload({ waitUntil: 'networkidle' })
  const stored = await p.evaluate(() => localStorage.getItem('collated:settings') ?? '')
  check(stored.includes('"ocrLanguage":"fra"'), 'the OCR language is remembered', stored)
  await ctx.close()
}

// 33. Insert blank page (#80): after the selected page, sized by page setup,
// numbered, never flagged as blank; nothing in the PDF but its number.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-portrait.jpg', 'quad-landscape.jpg'].map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="2 pages"]')
  await pageSetup(p, async (panel) => {
    await panel.getByLabel('Page size').selectOption('letter')
  })
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  await card(1).click()
  await p.getByRole('button', { name: 'More' }).click()
  const more = p.getByRole('dialog', { name: 'More' })
  check(
    (await more.getByText('After page 1, sized by page setup.').count()) === 1,
    'the More menu says where the blank page goes',
  )
  await more.getByRole('button', { name: 'Insert blank page' }).click()
  await p.waitForSelector('ol[aria-label="3 pages"]')
  check(
    JSON.stringify(await pageNames(p)) ===
      JSON.stringify(['quad-portrait.jpg', 'Blank page', 'quad-landscape.jpg']),
    'the blank page goes after the selected page',
    (await pageNames(p)).join(', '),
  )
  const panel = p.locator('aside[aria-label="Selected page"]')
  await panel.getByRole('heading', { name: 'Blank page' }).waitFor()
  await panel.getByText('Landscape', { exact: true }).click()
  // Give the blank-page check time to run over every page.
  await p.waitForTimeout(1500)
  check(
    (await p.getByText('Looks blank', { exact: true }).count()) === 0,
    'an inserted blank page is not flagged as looking blank',
  )
  await axe(p, 'blank page inspector')
  await p.screenshot({ path: join(shots, 'blank-page.png') })
  await exportMenu(p).click()
  await p
    .getByRole('dialog', { name: 'Export options' })
    .getByRole('checkbox', { name: 'Page numbers' })
    .check()
  await p.keyboard.press('Escape')
  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const out = join(mkdtempSync(join(tmpdir(), 'collated-verify-blank-')), 'blank.pdf')
  await dl.saveAs(out)
  const pdf = await PDFDocument.load(readFileSync(out))
  const blank = pdf.getPage(1)
  check(
    pdf.getPageCount() === 3 && blank.getWidth() === 792 && blank.getHeight() === 612,
    'the blank page is a landscape Letter page in the PDF',
    `${pdf.getPageCount()} pages; ${blank.getWidth()} × ${blank.getHeight()}`,
  )
  const xobjects = blank.node.Resources()?.lookup(PDFName.of('XObject'))
  check(
    !xobjects || xobjects.keys().length === 0,
    'the blank page has no image',
    xobjects?.toString() ?? '',
  )
  if (hasPoppler) {
    const text = execFileSync('pdftotext', ['-f', '2', '-l', '2', out, '-']).toString().trim()
    check(text === '2', 'the blank page carries only its page number', JSON.stringify(text))
  }
  await ctx.close()
}

// 34. Support note (#99): one quiet note after a good export, with plain
// links out (nothing loads from Ko-fi or GitHub), and gone for good on
// Don't ask again.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-portrait.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const note = p.getByRole('region', { name: 'Thanks for using Collated' })
  await note.waitFor()
  check(
    (await note.getByRole('link', { name: /Ko-fi/ }).getAttribute('href')) ===
      'https://ko-fi.com/mtblck' &&
      (await note.getByRole('link', { name: /GitHub Sponsors/ }).getAttribute('href')) ===
        'https://github.com/sponsors/mtblck',
    'the support note links to Ko-fi and GitHub Sponsors',
  )
  check(
    !(await note.evaluate((el) => el.contains(document.activeElement))),
    'the support note takes no focus',
  )
  await axe(p, 'support note')
  await p.screenshot({ path: join(shots, 'support-note.png') })
  await note.getByRole('button', { name: 'Don’t ask again' }).click()
  await note.waitFor({ state: 'hidden' })
  check(
    (await p.evaluate(() => localStorage.getItem('collated:support-prompt'))) === 'off',
    'Don’t ask again is remembered',
  )
  // A new visit, which would be due again but for Don't ask again.
  await p.reload({ waitUntil: 'networkidle' })
  const offer = p.getByRole('region', { name: 'Restore your last document?' })
  await offer.waitFor()
  await offer.getByRole('button', { name: 'Discard' }).click()
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-portrait.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await Promise.all([p.waitForEvent('download'), exportNow(p)])
  await p.waitForTimeout(500)
  check((await note.count()) === 0, 'no support note after Don’t ask again')
  await ctx.close()
}

// 35. The wordmark goes home: the landing view, offering the document back
// even straight after a change; asks first when the document isn't kept.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'quad-landscape.jpg'),
    join(fixtures, 'quad-portrait.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]')
  await p.waitForTimeout(1000)
  const home = p.getByRole('link', { name: 'Collated home' })
  check((await home.getAttribute('href')) === '/', 'the wordmark links to the home page')
  // No wait after this change: the click saves it before leaving.
  await p.getByRole('button', { name: 'Remove page 1' }).click()
  await p.waitForSelector('ol[aria-label="1 page"]')
  await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle' }), home.click()])
  const offer = p.getByRole('region', { name: 'Restore your last document?' })
  await offer.waitFor()
  check(
    /^Restore your last document\?1 page,/.test((await offer.textContent()) ?? ''),
    'the wordmark leads to the landing view, which offers the document back with the last change',
    (await offer.textContent()) ?? '',
  )
  await offer.getByRole('button', { name: 'Restore' }).click()
  await p.waitForSelector('ol[aria-label="1 page"]')

  // Keep work off: it asks, and Stay stays.
  await p.getByRole('button', { name: 'More' }).click()
  await p
    .getByRole('dialog', { name: 'More' })
    .getByRole('switch', { name: 'Keep work after a reload' })
    .click()
  await p.keyboard.press('Escape')
  await home.click()
  const leave = p.getByRole('dialog', { name: 'Leave this document?' })
  await leave.waitFor()
  check(
    await leave.getByRole('button', { name: 'Stay' }).evaluate((b) => b === document.activeElement),
    'the leave confirmation opens on Stay',
  )
  await axe(p, 'leave confirmation')
  await p.screenshot({ path: join(shots, 'leave-confirm.png') })
  await leave.getByRole('button', { name: 'Stay' }).click()
  check((await p.locator('ol[aria-label="1 page"]').count()) === 1, 'Stay keeps the document')
  await Promise.all([
    p.waitForNavigation({ waitUntil: 'networkidle' }),
    (async () => {
      await home.click()
      await leave.getByRole('button', { name: 'Leave' }).click()
    })(),
  ])
  check(
    (await p.getByRole('region', { name: 'Restore your last document?' }).count()) === 0 &&
      (await p.getByRole('navigation', { name: 'About Collated' }).count()) === 1,
    'Leave goes to the landing view, with nothing kept to offer',
  )
  await ctx.close()
}

// 36. Support button (tipjar, ADR 0017): floats on the landing view in place
// of the header's Support link, tucks away over the footer, isn't in the
// workspace, and loads nothing from elsewhere.
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1280, height: 900 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const tip = p.getByRole('link', { name: 'Support Collated on Ko-fi (opens in a new tab)' })
  check(
    (await tip.count()) === 1 &&
      (await tip.getAttribute('href')) === 'https://ko-fi.com/mtblck' &&
      (await tip.isVisible()) &&
      (await p
        .getByRole('navigation', { name: 'About Collated' })
        .getByRole('link', { name: /Support/ })
        .count()) === 0,
    'the landing view has one floating Support button and no Support link in the header',
  )
  const box = await tip.boundingBox()
  check(
    box !== null &&
      box.height >= 44 &&
      1280 - (box.x + box.width) <= 24 &&
      900 - (box.y + box.height) <= 24,
    'the Support button sits in the bottom-right corner with a 44px target',
    JSON.stringify(box),
  )
  check(
    (await tip.getAttribute('style')) === null,
    'the Support button has no inline style for the CSP to block',
  )
  await axe(p, 'landing with Support button')
  await p.screenshot({ path: join(shots, 'tipjar-landing.png') })
  await p.locator('footer').scrollIntoViewIfNeeded()
  await p.waitForFunction(() => document.querySelector('.tipjar')?.hasAttribute('data-tucked'))
  // It fades out over 0.2s.
  await tip.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {})
  check(!(await tip.isVisible()), 'the Support button tucks away while the footer shows')
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-portrait.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  check((await p.locator('.tipjar').count()) === 0, 'the workspace has no floating Support button')
  await ctx.close()
  // On a phone it folds to its heart, keeping its name.
  const { context: phone, page: q } = await open({ viewport: { width: 390, height: 844 } })
  await q.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const small = await q.locator('.tipjar').boundingBox()
  check(
    small !== null && small.width <= 48,
    'on a phone the Support button is just its icon',
    JSON.stringify(small),
  )
  await q.screenshot({ path: join(shots, 'tipjar-phone.png') })
  await phone.close()
}

// 37. Password-protected PDFs (#114), by touch on a phone: asks, asks again
// when wrong, opens; what's kept and exported needs no password, and the
// password is stored nowhere, so restored work comes back without asking.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-password.pdf')])
  const prompt = p.getByRole('dialog', { name: 'Password for quad-password.pdf' })
  await prompt.waitFor({ timeout: 20_000 })
  const field = prompt.getByLabel('Password', { exact: true })
  const sizes = await prompt.evaluate((d) => ({
    width: d.getBoundingClientRect().width,
    font: parseFloat(getComputedStyle(d.querySelector('input')).fontSize),
    targets: [...d.querySelectorAll('input, button')].map(
      (el) => el.getBoundingClientRect().height,
    ),
  }))
  check(
    sizes.width <= 390 - 32 && sizes.font >= 16 && sizes.targets.every((h) => h >= 44),
    'the password prompt fits a phone, with 16px text (no zoom) and 44px targets',
    JSON.stringify(sizes),
  )
  await axe(p, 'PDF password prompt on a phone')
  await field.tap()
  await p.keyboard.type('wrong-guess')
  await prompt.getByRole('button', { name: 'Open' }).tap()
  await prompt.getByRole('alert').waitFor({ timeout: 10_000 })
  check(
    (await prompt.getByRole('alert').textContent())?.includes('didn’t open it') ?? false,
    'a wrong password says so and asks again',
  )
  await p.screenshot({ path: join(shots, 'pdf-password-wrong.png') })
  await field.tap()
  await p.keyboard.type('user-secret')
  await prompt.getByRole('button', { name: 'Open' }).tap()
  await p.waitForSelector('ol[aria-label="3 pages"]', { timeout: 20_000 })
  check((await p.getByRole('dialog').count()) === 0, 'the right password opens it: 3 pages')
  await p.screenshot({ path: join(shots, 'pdf-password-opened.png') })

  const [dl] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
  const outPath = join(mkdtempSync(join(tmpdir(), 'collated-verify-locked-')), 'unlocked.pdf')
  await dl.saveAs(outPath)
  const out = readFileSync(outPath)
  const exported = await PDFDocument.load(out).catch(() => null)
  check(
    exported?.getPageCount() === 3 && !/\/Subtype\s*\/Image/.test(out.toString('latin1')),
    'its export opens without a password and keeps the pages as vectors',
  )

  await p.waitForTimeout(1000) // saved shortly after each change
  const kept = await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('collated-work')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const tx = req.result.transaction(['bytes', 'doc'], 'readonly')
          const all = tx.objectStore('bytes').getAll()
          const doc = tx.objectStore('doc').get('current')
          tx.oncomplete = () => {
            // Bytes are stored as Uint8Arrays, one per file.
            const latin1 = new TextDecoder('latin1')
            resolve({
              files: all.result.length,
              text:
                all.result.map((bytes) => latin1.decode(bytes)).join('') +
                JSON.stringify(doc.result),
            })
            req.result.close()
          }
        }
      }),
  )
  check(
    kept.files === 1 && !kept.text.includes('user-secret') && !kept.text.includes('/Encrypt'),
    'the device keeps one unlocked copy and never the password',
    `${kept.files} files`,
  )
  await p.reload({ waitUntil: 'networkidle' })
  const offer = p.getByRole('region', { name: 'Restore your last document?' })
  await offer.waitFor()
  await offer.getByRole('button', { name: 'Restore' }).tap()
  await p.waitForSelector('ol[aria-label="3 pages"]', { timeout: 20_000 })
  check(
    (await p.getByRole('dialog').count()) === 0,
    'restored work comes back without asking for the password',
  )

  // Owner-password-only (print or copy restrictions): opens without asking.
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-owner-locked.pdf')])
  await p.waitForSelector('ol[aria-label="6 pages"]', { timeout: 20_000 })
  check(
    (await p.getByRole('dialog').count()) === 0,
    'an owner-password-only PDF opens without asking',
  )
  await phone.close()
}

// 38. TIFF (#113), by touch on a phone: a two-page G4 fax, a standard-
//     resolution G3 fax, LZW and JPEG colour scans come in page by page;
//     fax pages stay 1-bit in the PDF, and "Match image" sizes each page to
//     the paper its file says was scanned.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const tiffs = [
    'fax-g4-2pages.tif',
    'fax-g3-normal.tif',
    'scan-lzw-300dpi.tif',
    'scan-jpeg-150dpi.tif',
  ]
  const [chooser] = await Promise.all([
    p.waitForEvent('filechooser'),
    p.getByRole('button', { name: 'Choose files' }).tap(),
  ])
  await chooser.setFiles(tiffs.map((f) => join(fixtures, f)))
  await p.waitForSelector('ol[aria-label="5 pages"]', { timeout: 30_000 })
  const labels = await p
    .locator('ol[aria-label="5 pages"] [data-page-select]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  check(
    labels.join(' | ') ===
      'Page 1: fax-g4-2pages · p1 | Page 2: fax-g4-2pages · p2 | Page 3: fax-g3-normal.tif | Page 4: scan-lzw-300dpi.tif | Page 5: scan-jpeg-150dpi.tif',
    'a phone adds TIFFs by touch, one page per TIFF page, in order',
    labels.join(' | '),
  )
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 390)
  check(overflow <= 0, 'TIFF pages fit the phone without sideways scrolling', `${overflow}px`)
  await p.waitForTimeout(500) // thumbnails
  await p.screenshot({ path: join(shots, 'tiff-phone.png') })
  await axe(p, 'phone with TIFF pages')
  await phone.close()

  const { context: ctx, page: d } = await open({ viewport: { width: 1440, height: 1000 } })
  await d.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await d.setInputFiles(
    '[data-testid="file-input"]',
    tiffs.map((f) => join(fixtures, f)),
  )
  await d.waitForSelector('ol[aria-label="5 pages"]', { timeout: 30_000 })
  await pageSetup(d, async (panel) => {
    await panel.getByLabel('Page size').selectOption('image')
  })
  const [download] = await Promise.all([d.waitForEvent('download'), exportNow(d)])
  const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-tiff-')), 'tiff.pdf')
  await download.saveAs(path)
  const pdf = await PDFDocument.load(readFileSync(path))
  const sizes = pdf
    .getPages()
    .map((pg) => `${Math.round(pg.getWidth())}×${Math.round(pg.getHeight())}`)
  // Faxes: 1728 dots at 204 dpi = 610 pt; G4 2200 rows at 196 dpi and G3
  // 1100 at 98 both come to 808 pt. Scans: 600 × 400 at 300 dpi and 150 dpi.
  check(
    sizes.join(', ') === '610×808, 610×808, 610×808, 144×96, 288×192',
    'match-image TIFF pages take the size the file was scanned at',
    sizes.join(', '),
  )
  check(
    statSync(path).size < 60_000,
    'three fax pages and two small scans export small',
    `${statSync(path).size} bytes`,
  )
  if (hasPoppler) {
    const list = execFileSync('pdfimages', ['-list', path], { encoding: 'utf8' })
    // page num type width height color comp bpc …
    const bpc = list
      .split('\n')
      .slice(2)
      .filter(Boolean)
      .map((line) => line.trim().split(/\s+/))
      .map((cols) => `${cols[0]}:${cols[5]}/${cols[7]}`)
    check(
      bpc.join(' ') === '1:gray/1 2:gray/1 3:gray/1 4:rgb/8 5:rgb/8',
      'fax pages are 1-bit grey in the PDF, scans are colour',
      bpc.join(' '),
    )
  }
  await ctx.close()
}

// 39. Sign a page (#111), by touch on a 375px phone: the pad fills the
//     screen, a finger draws, pinch sizes, a drag places; one undo step;
//     the PDF has it where the preview does, over a page kept as vectors;
//     saved on the device, deletable; typed and placed by keyboard too.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 375, height: 740 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const form = await PDFDocument.create()
  const formPage = form.addPage([612, 792])
  const helvetica = await form.embedFont(StandardFonts.Helvetica)
  formPage.drawText('TENANT SIGNATURE', { x: 72, y: 120, size: 14, font: helvetica })
  const dir = mkdtempSync(join(tmpdir(), 'collated-verify-sign-'))
  const formPath = join(dir, 'lease.pdf')
  writeFileSync(formPath, await form.save())
  await p.setInputFiles('[data-testid="file-input"]', [
    formPath,
    join(fixtures, 'quad-landscape.png'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]', { timeout: 20_000 })
  const card = (n) => p.locator(`ol[aria-label] > li:nth-child(${n}) [data-page-select]`)
  const panel = p.locator('aside[aria-label="Selected page"]')
  const cdp = await phone.newCDPSession(p)
  const touch = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    })
  /** One finger along `path`, or several fingers along paths of equal length. */
  const gesture = async (...paths) => {
    await touch(
      'touchStart',
      paths.map((path) => path[0]),
    )
    for (let i = 1; i < paths[0].length; i++) {
      await touch(
        'touchMove',
        paths.map((path) => path[i]),
      )
    }
    await touch('touchEnd', [])
  }
  // Chromium drops the first tap after a gesture sent through CDP (a second
  // one lands), so buttons pressed right after a gesture are clicked.
  const line = (from, to, steps = 8) =>
    Array.from({ length: steps + 1 }, (_, i) => [
      from[0] + ((to[0] - from[0]) * i) / steps,
      from[1] + ((to[1] - from[1]) * i) / steps,
    ])

  await card(1).tap()
  await panel.getByRole('button', { name: 'Sign this page…' }).tap()
  const maker = p.getByRole('dialog', { name: 'Add a signature' })
  await maker.waitFor()
  const makerBox = await maker.boundingBox()
  const pad = maker.locator('[data-signature-pad]')
  const padBox = await pad.boundingBox()
  check(
    makerBox?.width === 375 && makerBox.height >= 739 && padBox && padBox.height > 300,
    'the signature pad fills the phone screen',
    JSON.stringify({ makerBox, padBox }),
  )
  await axe(p, 'signature pad on a phone')
  // A finger signs: a loop and a tail.
  const px = (fx, fy) => [padBox.x + fx * padBox.width, padBox.y + fy * padBox.height]
  await gesture([px(0.15, 0.6), px(0.3, 0.35), px(0.4, 0.65), px(0.55, 0.4), px(0.7, 0.62)])
  await gesture(line(px(0.2, 0.7), px(0.85, 0.66)))
  check(
    !(await maker.getByLabel('Save on this device for next time').isChecked()),
    'saving a signature on the device is off until chosen',
  )
  await maker.getByLabel('Save on this device for next time').check()
  await p.screenshot({ path: join(shots, 'sign-pad-phone.png') })
  await maker.getByRole('button', { name: 'Use this signature' }).click()
  const editor = p.getByRole('dialog', { name: 'Sign page 1' })
  await maker.waitFor({ state: 'hidden' })
  const signature = editor.getByRole('button', { name: 'Signature 1', exact: true })
  await signature.waitFor()
  check(
    await signature.evaluate((el) => el === document.activeElement),
    'the new signature is focused once the pad closes',
  )
  const where = async () =>
    signature.evaluate(
      (el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
    )
  const widthOf = async () => Number(/([\d.]+)% of the page wide/.exec(await where())?.[1])
  const before = await widthOf()
  // Pinch it bigger: two fingers moving apart either side of it.
  const s1 = await signature.boundingBox()
  const c = [s1.x + s1.width / 2, s1.y + s1.height / 2]
  await gesture(
    line([c[0] - 20, c[1]], [c[0] - 45, c[1]]),
    line([c[0] + 20, c[1]], [c[0] + 45, c[1]]),
  )
  const pinched = await widthOf()
  check(
    pinched > before * 1.6 && pinched < before * 3,
    'pinching sizes the signature',
    `${before}% → ${pinched}%`,
  )
  // Drag it onto the line above "TENANT SIGNATURE" (y 792 − 120 − 30 from the top).
  const stage = editor.locator('[data-mark-stage]')
  const st = await stage.boundingBox()
  const target = [st.x + 0.4 * st.width, st.y + (642 / 792) * st.height]
  const s2 = await signature.boundingBox()
  await gesture(line([s2.x + s2.width / 2, s2.y + s2.height / 2], target, 10))
  const placed = await where()
  check(/^40(\.\d)?% across, 81(\.\d)?% down/.test(placed), 'dragging places the signature', placed)
  await p.screenshot({ path: join(shots, 'sign-place-phone.png') })
  await axe(p, 'sign editor on a phone')
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 375)
  check(overflow <= 0, 'the sign editor fits a 375px phone', `${overflow}px`)
  await editor.getByRole('button', { name: 'Apply' }).click()
  await editor.waitFor({ state: 'hidden' })
  const signed = async () => /, signed/.test((await card(1).getAttribute('aria-label')) ?? '')
  check(await signed(), 'the page is signed in the grid')
  await p.keyboard.press('Control+z')
  check(!(await signed()), 'one undo takes the signature off')
  await p.keyboard.press('Control+Shift+z')
  check(await signed(), 'redo puts it back')

  // The PDF: the signature where the grid's preview draws it, the page still vectors.
  const sheet = await card(1).locator('.sheet').boundingBox()
  const ink = await card(1).locator('img[data-mark]').boundingBox()
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120_000 }), exportNow(p)])
  const out = join(dir, 'signed.pdf')
  await dl.saveAs(out)
  const pdf = await PDFDocument.load(readFileSync(out))
  const xobjects = pdf.getPage(0).node.Resources()?.lookup(PDFName.of('XObject'))
  check(
    xobjects && xobjects.keys().length === 2,
    'the signed PDF page holds its own page and one signature image',
  )
  if (hasPoppler) {
    check(
      execFileSync('pdftotext', ['-f', '1', '-l', '1', out, '-']).toString().includes('TENANT'),
      'the signed PDF page keeps its text',
    )
    const prefix = join(dir, 'signed-page')
    execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', '-singlefile', out, prefix])
    const box = {
      x0: (ink.x - sheet.x) / sheet.width,
      y0: (ink.y - sheet.y) / sheet.height,
      x1: (ink.x + ink.width - sheet.x) / sheet.width,
      y1: (ink.y + ink.height - sheet.y) / sheet.height,
    }
    const dark = await p.evaluate(
      async ({ png, box }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${png}`
        await img.decode()
        const canvas = new OffscreenCanvas(img.width, img.height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const share = (x0, y0, x1, y1) => {
          const w = Math.max(1, Math.round((x1 - x0) * img.width))
          const h = Math.max(1, Math.round((y1 - y0) * img.height))
          const { data } = ctx.getImageData(
            Math.round(x0 * img.width),
            Math.round(y0 * img.height),
            w,
            h,
          )
          let n = 0
          for (let i = 0; i < data.length; i += 4) if (data[i] < 100) n++
          return n / (w * h)
        }
        return {
          inside: share(box.x0, box.y0, box.x1, box.y1),
          above: share(box.x0, box.y0 - 0.15, box.x1, box.y0 - 0.05),
        }
      },
      { png: readFileSync(`${prefix}.png`).toString('base64'), box },
    )
    check(
      dark.inside > 0.03 && dark.above < 0.005,
      'the PDF draws the signature where the preview does',
      JSON.stringify(dark),
    )
  }

  // Saved on this device: offered next time, and deleted from there.
  await card(2).tap()
  await panel.getByRole('button', { name: 'Sign this page…' }).tap()
  await maker.waitFor()
  const savedOne = maker.getByRole('button', { name: 'Use saved signature 1' })
  check((await savedOne.count()) === 1, 'the signature is saved on this device for next time')
  await p.screenshot({ path: join(shots, 'sign-saved-phone.png') })
  await maker.getByRole('button', { name: 'Delete saved signature 1 from this device' }).tap()
  await maker.getByRole('radio', { name: 'Draw' }).waitFor()
  const left = await p.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('collated-signatures')
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const q = req.result.transaction('signatures').objectStore('signatures').count()
          q.onsuccess = () => resolve(q.result)
        }
      }),
  )
  check(
    left === 0 && (await savedOne.count()) === 0,
    'deleting a saved signature removes it',
    String(left),
  )
  await maker.getByRole('button', { name: 'Cancel' }).tap()
  await p.getByRole('dialog', { name: 'Sign page 2' }).getByRole('button', { name: 'Cancel' }).tap()
  await phone.close()

  // By keyboard on a desk: type a name, place it with the arrow keys.
  const { context: desk, page: d } = await open({ viewport: { width: 1280, height: 900 } })
  await d.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await d.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'quad-landscape.png')])
  await d.waitForSelector('ol[aria-label="1 page"]', { timeout: 20_000 })
  await d.locator('[data-page-select]').first().click()
  await d.getByRole('button', { name: 'Sign this page…' }).focus()
  await d.keyboard.press('Enter')
  const typer = d.getByRole('dialog', { name: 'Add a signature' })
  // A photo of a signature on unevenly lit paper: the paper goes, the ink stays.
  const photo = await d.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 400
    const ctx = canvas.getContext('2d')
    const light = ctx.createLinearGradient(0, 0, 800, 0)
    light.addColorStop(0, '#a49e94')
    light.addColorStop(1, '#f4f1ea')
    ctx.fillStyle = light
    ctx.fillRect(0, 0, 800, 400)
    ctx.strokeStyle = '#1b2a6e'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(120, 260)
    ctx.bezierCurveTo(220, 60, 320, 330, 420, 160)
    ctx.bezierCurveTo(500, 40, 600, 300, 690, 210)
    ctx.stroke()
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  })
  const photoPath = join(dir, 'signature-photo.jpg')
  writeFileSync(photoPath, Buffer.from(photo, 'base64'))
  await typer.getByRole('radio', { name: 'Photo' }).check({ force: true })
  await d.setInputFiles('[data-testid="signature-photo-input"]', photoPath)
  const fromPhoto = typer.getByRole('img', { name: /signature from the photo/ })
  await fromPhoto.waitFor({ timeout: 10_000 })
  const cleared = await fromPhoto.evaluate(async (img) => {
    await img.decode()
    const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let clear = 0
    let blue = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) clear++
      else if (data[i + 2] > data[i] + 20) blue++
    }
    return { clear: clear / (data.length / 4), blue, w: canvas.width, h: canvas.height }
  })
  check(
    cleared.clear > 0.7 && cleared.blue > 500 && cleared.w > 450,
    'a photographed signature keeps its ink and loses the paper',
    JSON.stringify(cleared),
  )
  await typer.getByRole('radio', { name: 'Type' }).check({ force: true })
  await typer.getByLabel('Your name').fill('Avery Quinn')
  await typer.getByRole('button', { name: 'Use this signature' }).click()
  const deskEditor = d.getByRole('dialog', { name: 'Sign page 1' })
  const typed = deskEditor.getByRole('button', { name: 'Signature 1', exact: true })
  await typed.waitFor()
  await d.keyboard.press('Shift+ArrowUp')
  await d.keyboard.press('+')
  await d.keyboard.press(']')
  const typedWhere = await typed.evaluate(
    (el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
  )
  check(
    /^50% across, 70% down, .* turned 1°$/.test(typedWhere),
    'a typed signature moves, sizes and turns from the keyboard',
    typedWhere,
  )
  const typedImg = await deskEditor
    .locator('img')
    .last()
    .evaluate((img) => img.naturalWidth)
  check(typedImg > 200, 'the typed name is drawn in the script face', String(typedImg))
  await d.screenshot({ path: join(shots, 'sign-typed.png') })
  await deskEditor.getByRole('button', { name: 'Apply' }).click()
  const kept = await d.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('collated-signatures')
        req.onsuccess = () => {
          const q = req.result.transaction('signatures').objectStore('signatures').count()
          q.onsuccess = () => resolve(q.result)
        }
      }),
  )
  check(kept === 0, 'a signature is not saved unless chosen', String(kept))
  await desk.close()
}

// 40. Scanned PDFs shrink (#115), by touch on a phone: Small caps the scan
// inside a PDF page and the photo on another, with the real canvas; every
// page keeps its text (the scan's invisible layer included), looks the same,
// and the estimate counts it.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const input = join(fixtures, 'scan-heavy.pdf')
  await p.setInputFiles('[data-testid="file-input"]', [input])
  await p.waitForSelector('ol[aria-label="3 pages"]', { timeout: 20_000 })
  const save = async (name) => {
    const [d] = await Promise.all([p.waitForEvent('download'), exportNow(p)])
    const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-shrink-')), name)
    await d.saveAs(path)
    await p.waitForFunction(() => !/Building/.test(document.body.innerText))
    return { path, bytes: readFileSync(path) }
  }
  // Pages as they are, so dpi reads off the PDF directly.
  await pageSetup(p, async (panel) => {
    await panel.getByLabel('Page size').selectOption('image')
  })
  const original = await save('original.pdf')
  await exportMenu(p).tap()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  const small = dialog.getByRole('radio', { name: /Small/ })
  await small.scrollIntoViewIfNeeded()
  await dialog.getByText('Small', { exact: true }).tap()
  check(await small.isChecked(), 'Small can be picked by touch')
  check(
    await dialog.getByText('the pictures inside PDF pages', { exact: false }).isVisible(),
    'the quality options say they cover pictures inside PDF pages',
  )
  const estimateText = (await dialog.locator('dd').first().textContent()) ?? ''
  await dialog.getByRole('radio', { name: /Small/ }).scrollIntoViewIfNeeded()
  await p.screenshot({ path: join(shots, 'shrink-pdf-phone.png') })
  await p.keyboard.press('Escape')
  const shrunk = await save('small.pdf')
  const inputBytes = readFileSync(input).byteLength
  check(
    shrunk.bytes.byteLength < inputBytes * 0.4 && original.bytes.byteLength > inputBytes * 0.9,
    `Small shrinks a scanned PDF (${(original.bytes.byteLength / 1e6).toFixed(2)} MB → ${(shrunk.bytes.byteLength / 1e6).toFixed(2)} MB)`,
  )
  const estimated = /≈ ([\d.]+) (KB|MB)/.exec(estimateText)
  const est = estimated ? Number(estimated[1]) * (estimated[2] === 'MB' ? 1024 * 1024 : 1024) : 0
  check(
    est > shrunk.bytes.byteLength * 0.5 && est < shrunk.bytes.byteLength * 2,
    'the estimate counts the PDF’s pictures shrunk',
    `${estimateText} vs ${shrunk.bytes.byteLength} bytes`,
  )
  if (hasPoppler) {
    const images = execFileSync('pdfimages', ['-list', shrunk.path])
      .toString()
      .split('\n')
      .slice(2)
      .filter((l) => l.trim())
      .map((l) => l.trim().split(/\s+/))
      .map((c) => `${c[0]}:${c[3]}x${c[4]}:${c[8]}`)
    check(
      images.join(' ') === '1:1275x1650:jpeg 2:600x800:jpeg',
      'the scan is capped at 150 dpi and the Flate photo becomes a JPEG',
      images.join(' '),
    )
    const text = execFileSync('pdftotext', [shrunk.path, '-']).toString()
    check(
      ['Invoice searchable layer', 'Kept as text', 'Plain text page'].every((t) =>
        text.includes(t),
      ),
      'every page keeps its text, the scan’s invisible layer included',
      text,
    )
    for (const n of ['1', '2']) {
      const render = (path) => {
        const prefix = path.replace(/\.pdf$/, `-${n}`)
        execFileSync('pdftoppm', [
          '-png',
          '-r',
          '36',
          '-f',
          n,
          '-l',
          n,
          '-singlefile',
          path,
          prefix,
        ])
        return readFileSync(`${prefix}.png`).toString('base64')
      }
      const diff = await compareImages(render(shrunk.path), render(original.path))
      check(
        diff.farShare < 0.01,
        `page ${n} looks the same shrunk (${(diff.farShare * 100).toFixed(2)}% of pixels differ)`,
      )
    }
  }
  await phone.close()
}

// 41. Text, dates and ticks (#112), by touch on a 390px phone: type a name
//     with the on-screen keyboard up and the box still in view, tap it and a
//     tick into place, a date too; one undo step; the PDF has the name as
//     real text and the tick where the preview draws them.
{
  const { page: p, context: phone } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  const form = await PDFDocument.create()
  const formPage = form.addPage([612, 792])
  const helvetica = await form.embedFont(StandardFonts.Helvetica)
  formPage.drawText('NAME', { x: 72, y: 700, size: 12, font: helvetica })
  formPage.drawRectangle({ x: 72, y: 600, width: 20, height: 20, borderWidth: 1 })
  formPage.drawText('I agree', { x: 100, y: 605, size: 12, font: helvetica })
  const dir = mkdtempSync(join(tmpdir(), 'collated-verify-fill-'))
  const formPath = join(dir, 'form.pdf')
  writeFileSync(formPath, await form.save())
  await p.setInputFiles('[data-testid="file-input"]', formPath)
  await p.waitForSelector('ol[aria-label="1 page"]', { timeout: 20_000 })
  const card = p.locator('ol[aria-label] > li:nth-child(1) [data-page-select]')
  const panel = p.locator('aside[aria-label="Selected page"]')
  await card.tap()
  await panel.getByRole('button', { name: 'Add text or ticks…' }).tap()
  const editor = p.getByRole('dialog', { name: 'Fill and sign page 1' })
  await editor.waitFor()
  check(
    (await p.getByRole('dialog', { name: 'Add a signature' }).count()) === 0,
    'adding text opens the page, not the signature pad',
  )
  await editor.getByRole('button', { name: 'Text', exact: true }).tap()
  const box = editor.getByLabel('Text 1: what it says')
  check(
    await box.evaluate((el) => el === document.activeElement),
    'new text puts the cursor in its box',
  )
  // The on-screen keyboard: the visual viewport shrinks to 460px.
  await p.evaluate(() => {
    const vv = window.visualViewport
    Object.defineProperty(vv, 'height', { configurable: true, get: () => 460 })
    vv.dispatchEvent(new Event('resize'))
  })
  await box.fill('Avery Quinn')
  const name = editor.getByRole('button', { name: 'Text 1', exact: true })
  const above = await p.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const field = document.querySelector('[data-mark-text]')
    const handle = document.querySelector('[data-mark-stage] [aria-pressed="true"]')
    return {
      dialog: dialog?.getBoundingClientRect().bottom,
      field: field?.getBoundingClientRect().bottom,
      handle: handle?.getBoundingClientRect().bottom,
    }
  })
  check(
    above.dialog <= 461 && above.field <= 460 && above.handle <= 460,
    'the text and its box stay above the on-screen keyboard',
    JSON.stringify(above),
  )
  await p.screenshot({ path: join(shots, 'fill-type-phone.png') })
  await p.evaluate(() => {
    const vv = window.visualViewport
    delete vv.height
    vv.dispatchEvent(new Event('resize'))
  })
  await p.waitForFunction(() => !document.querySelector('dialog[data-keyboard]'))
  const where = async (handle) =>
    handle.evaluate(
      (el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
    )
  // Tap where the name goes: right of "NAME", on its line (y 792 − 700 from the top).
  const stage = editor.locator('[data-mark-stage]')
  const st = await stage.boundingBox()
  const tapAt = (fx, fy) => stage.tap({ position: { x: fx * st.width, y: fy * st.height } })
  await tapAt(0.4, (792 - 704) / 792)
  check(
    /^“Avery Quinn”, 40(\.\d)?% across, 11(\.\d)?% down, 12 pt$/.test(await where(name)),
    'a tap puts the text where it goes',
    await where(name),
  )
  // A tick in the box, in blue, a little bigger.
  await editor.getByRole('button', { name: 'Tick', exact: true }).tap()
  const tick = editor.getByRole('button', { name: 'Tick 1', exact: true })
  await tapAt(82 / 612, (792 - 610) / 792)
  await editor.getByRole('button', { name: 'Larger' }).tap()
  await editor.getByRole('radio', { name: 'Blue' }).tap()
  check(
    /^13(\.\d)?% across, 23(\.\d)?% down/.test(await where(tick)),
    'a tap puts the tick in the box',
    await where(tick),
  )
  await editor.getByRole('button', { name: 'Date', exact: true }).tap()
  const today = await p.evaluate(() =>
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date()),
  )
  check(
    (await where(editor.getByRole('button', { name: 'Text 2', exact: true }))).includes(today),
    'Date adds today’s date',
    today,
  )
  await p.screenshot({ path: join(shots, 'fill-placed-phone.png') })
  await axe(p, 'fill editor on a phone')
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 390)
  check(overflow <= 0, 'the fill editor fits a 390px phone', `${overflow}px`)
  await editor.getByRole('button', { name: 'Apply' }).tap()
  await editor.waitFor({ state: 'hidden' })
  const filled = async () => /, filled in/.test((await card.getAttribute('aria-label')) ?? '')
  check(await filled(), 'the page is filled in in the grid')
  check(
    (await panel.getByRole('button', { name: 'Edit 3 items…' }).count()) === 1,
    'the panel offers to edit the three items',
  )
  await p.evaluate(() => document.activeElement?.blur())
  await p.keyboard.press('Control+z')
  check(!(await filled()), 'one undo takes them all off')
  await p.keyboard.press('Control+Shift+z')
  check(await filled(), 'redo puts them back')

  // The PDF: the name as real text, and the blue tick, where the preview draws them.
  const sheet = await card.locator('.sheet').boundingBox()
  const nameBox = await card.locator('svg[data-mark-kind="text"]').first().boundingBox()
  const tickBox = await card.locator('svg[data-mark-kind="stamp"]').boundingBox()
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120_000 }), exportNow(p)])
  const out = join(dir, 'filled.pdf')
  await dl.saveAs(out)
  if (hasPoppler) {
    const xml = execFileSync('pdftotext', ['-bbox', out, '-']).toString()
    const avery = /<word xMin="([\d.]+)" yMin="([\d.]+)"[^>]*>Avery<\/word>/.exec(xml)
    check(
      avery !== null && xml.includes('>Quinn<') && xml.includes(`>${today.split(' ')[0]}<`),
      'the PDF has the name and date as text',
    )
    const left = (nameBox.x - sheet.x) / sheet.width
    check(
      avery && Math.abs(Number(avery[1]) / 612 - left) < 0.01,
      'the PDF sets the name where the preview does',
      `${avery?.[1]} pt vs ${(left * 612).toFixed(1)} pt`,
    )
    const prefix = join(dir, 'filled-page')
    execFileSync('pdftoppm', ['-png', '-r', '72', '-f', '1', '-l', '1', '-singlefile', out, prefix])
    const blue = await p.evaluate(
      async ({ png, box }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${png}`
        await img.decode()
        const canvas = new OffscreenCanvas(img.width, img.height)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const share = (x0, y0, x1, y1) => {
          const w = Math.max(1, Math.round((x1 - x0) * img.width))
          const h = Math.max(1, Math.round((y1 - y0) * img.height))
          const { data } = ctx.getImageData(
            Math.round(x0 * img.width),
            Math.round(y0 * img.height),
            w,
            h,
          )
          let n = 0
          for (let i = 0; i < data.length; i += 4) if (data[i + 2] > data[i] + 60) n++
          return n / (w * h)
        }
        return {
          inside: share(box.x0, box.y0, box.x1, box.y1),
          beside: share(box.x1 + 0.05, box.y0, box.x1 + 0.05 + (box.x1 - box.x0), box.y1),
        }
      },
      {
        png: readFileSync(`${prefix}.png`).toString('base64'),
        box: {
          x0: (tickBox.x - sheet.x) / sheet.width,
          y0: (tickBox.y - sheet.y) / sheet.height,
          x1: (tickBox.x + tickBox.width - sheet.x) / sheet.width,
          y1: (tickBox.y + tickBox.height - sheet.y) / sheet.height,
        },
      },
    )
    check(
      blue.inside > 0.08 && blue.beside === 0,
      'the PDF draws the blue tick where the preview does',
      JSON.stringify(blue),
    )
  }
  await phone.close()
}

// 42. Pages as images (#117). On a phone, by touch: JPG, two pages, Export,
//     then the share sheet gets the images themselves. On a desktop: one page
//     downloads as a PNG drawn exactly as the PDF shows it (page numbers
//     included), and several JPGs come as one ZIP.
{
  const { context: phone, page: p } = await open({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  // The sandbox has no share sheet: record what would be shared.
  await p.addInitScript(() => {
    window.__shared = null
    navigator.canShare = (data) => Array.isArray(data?.files)
    navigator.share = async (data) => {
      window.__shared = await Promise.all(
        data.files.map(async (f) => {
          const bitmap = await createImageBitmap(f)
          return { name: f.name, type: f.type, width: bitmap.width, height: bitmap.height }
        }),
      )
    }
  })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'doc-colour.jpg'),
    join(fixtures, 'quad-portrait.jpg'),
  ])
  await p.waitForSelector('ol[aria-label="2 pages"]', { timeout: 20_000 })
  await exportMenu(p).tap()
  const panel = p.getByRole('dialog', { name: 'Export options' })
  await panel.getByRole('radio', { name: 'JPG' }).tap()
  await panel.getByRole('radio', { name: /^Small/ }).tap()
  const targets = await panel
    .locator('input[name$="-format"]')
    .evaluateAll((els) => els.map((el) => el.closest('label').getBoundingClientRect().height))
  check(
    targets.length === 3 && targets.every((h) => h >= 44),
    'PDF / JPG / PNG are 44px touch targets on a phone',
    targets.join(', '),
  )
  check(
    (await panel.getByLabel('Password to open').count()) === 0,
    'images hide the PDF-only options (password)',
  )
  await p.screenshot({ path: join(shots, 'images-options-phone.png') })
  await axe(p, 'export options set to JPG on a phone')
  await panel.getByRole('button', { name: 'Export 2 JPGs' }).tap()
  const ready = p.getByRole('dialog', { name: '2 JPGs ready' })
  await ready.waitFor({ timeout: 30_000 })
  await p.screenshot({ path: join(shots, 'images-share-phone.png') })
  await axe(p, 'images ready to share on a phone')
  await ready.getByRole('button', { name: 'Share…' }).tap()
  await p.waitForFunction(() => window.__shared !== null, null, { timeout: 10_000 })
  const shared = await p.evaluate(() => window.__shared)
  // Small is 150 dpi: US Letter 1275 × 1650, A4 1240 × 1754.
  check(
    shared.length === 2 &&
      shared.every(
        (f, i) =>
          f.name === `${/^scans-\d{4}-\d\d-\d\d/.exec(f.name)?.[0]}-page-${i + 1}.jpg` &&
          f.type === 'image/jpeg' &&
          ((f.width === 1275 && f.height === 1650) || (f.width === 1240 && f.height === 1754)),
      ),
    'the share sheet gets each page as a 150 dpi JPG',
    JSON.stringify(shared),
  )
  await phone.close()

  const { context: ctx, page: d } = await open({ viewport: { width: 1280, height: 900 } })
  await d.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await d.setInputFiles('[data-testid="file-input"]', [
    join(fixtures, 'doc-colour.jpg'),
    join(fixtures, 'quad-portrait.jpg'),
  ])
  await d.waitForSelector('ol[aria-label="2 pages"]', { timeout: 20_000 })
  const dir = mkdtempSync(join(tmpdir(), 'collated-verify-images-'))
  await exportMenu(d).click()
  const opts = d.getByRole('dialog', { name: 'Export options' })
  await opts.getByRole('checkbox', { name: 'Page numbers' }).check()
  await opts.getByRole('radio', { name: /^Small/ }).check()
  // The PDF first, to compare against.
  const [pdfDl] = await Promise.all([
    d.waitForEvent('download'),
    opts.getByRole('button', { name: 'Export PDF' }).click(),
  ])
  const pdfPath = join(dir, 'pages.pdf')
  await pdfDl.saveAs(pdfPath)

  await exportMenu(d).click()
  await opts.getByRole('radio', { name: 'JPG' }).check()
  const [zipDl] = await Promise.all([
    d.waitForEvent('download'),
    opts.getByRole('button', { name: 'Export 2 JPGs' }).click(),
  ])
  const zipped = unzipSync(readFileSync(await zipDl.path()))
  const names = Object.keys(zipped)
  check(
    names.length === 2 &&
      names.every((n, i) => n.endsWith(`-page-${i + 1}.jpg`)) &&
      Object.values(zipped).every((b) => b[0] === 0xff && b[1] === 0xd8),
    'several JPGs download as one ZIP, one per page, in order',
    names.join(', '),
  )

  // One page as PNG: select page 2, Selected pages.
  await d.locator('ol[aria-label="2 pages"] [data-page-select]').nth(1).click()
  await exportMenu(d).click()
  await opts.getByRole('radio', { name: 'PNG' }).check()
  await opts.getByRole('radio', { name: /^Selected pages/ }).check()
  const [pngDl] = await Promise.all([
    d.waitForEvent('download'),
    opts.getByRole('button', { name: 'Export PNG' }).click(),
  ])
  check(
    /^scans-\d{4}-\d\d-\d\d\.png$/.test(pngDl.suggestedFilename()),
    'one page downloads as a single PNG',
    pngDl.suggestedFilename(),
  )
  const png = readFileSync(await pngDl.path())
  if (hasPoppler) {
    const prefix = join(dir, 'ref')
    execFileSync('pdftoppm', [
      '-png',
      '-r',
      '150',
      '-f',
      '2',
      '-l',
      '2',
      '-singlefile',
      pdfPath,
      prefix,
    ])
    const ref = readFileSync(`${prefix}.png`)
    const diff = await d.evaluate(
      async ([a, b]) => {
        // Not fetch(data:): the CSP allows connections to 'self' only.
        const load = (b64) =>
          createImageBitmap(
            new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }),
          )
        const [x, y] = await Promise.all([load(a), load(b)])
        if (x.width !== y.width || x.height !== y.height)
          return { size: `${x.width}×${x.height} vs ${y.width}×${y.height}`, mean: 255 }
        const px = (bm) => {
          const c = new OffscreenCanvas(bm.width, bm.height)
          const g = c.getContext('2d')
          g.drawImage(bm, 0, 0)
          return g.getImageData(0, 0, bm.width, bm.height).data
        }
        const [p1, p2] = [px(x), px(y)]
        let sum = 0
        for (let i = 0; i < p1.length; i += 4) {
          sum +=
            Math.abs(p1[i] - p2[i]) +
            Math.abs(p1[i + 1] - p2[i + 1]) +
            Math.abs(p1[i + 2] - p2[i + 2])
        }
        return { size: `${x.width}×${x.height}`, mean: sum / (p1.length / 4) / 3 }
      },
      [png.toString('base64'), ref.toString('base64')],
    )
    check(
      diff.mean < 4,
      'the PNG matches poppler’s drawing of the PDF page (page number included)',
      JSON.stringify(diff),
    )
  }
  await ctx.close()
}

// 44. Scan pages (#118), by touch on a phone, with a fake camera: the paper
//     is outlined live and taken once steady, cropped to the outline; the
//     same page isn't taken twice; turning the page takes the next; Auto off
//     leaves the shutter; denied access offers Take photo. Then Chromium's
//     own fake camera under the real Permissions-Policy, stopped on close.
{
  const truth = JSON.parse(readFileSync(join(fixtures, 'paper-corners.json'), 'utf8'))
  const paper = readFileSync(join(fixtures, 'paper-dark-table.jpg')).toString('base64')
  /**
   * getUserMedia answered by a canvas stream: `window.__scene` picks what the
   * "camera" sees, the paper photo or the bare table (no paper). `deny`
   * answers as a person refusing access would.
   */
  const fakeCamera = ([b64, deny]) => {
    const md = navigator.mediaDevices
    md.getUserMedia = async () => {
      if (deny) throw new DOMException('Permission denied', 'NotAllowedError')
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], {
        type: 'image/jpeg',
      })
      const photo = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = photo.width
      canvas.height = photo.height
      const g = canvas.getContext('2d')
      window.__scene = window.__scene ?? 'paper'
      const draw = () => {
        if (window.__scene === 'paper') g.drawImage(photo, 0, 0)
        else {
          g.fillStyle = '#3a2a20'
          g.fillRect(0, 0, canvas.width, canvas.height)
        }
        // A changing pixel, so the stream keeps sending frames.
        g.fillStyle = `rgb(${Date.now() % 255},0,0)`
        g.fillRect(0, 0, 1, 1)
      }
      draw()
      setInterval(draw, 33)
      return canvas.captureStream(30)
    }
  }
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
  const { context: ctx, page: p } = await open(phone)
  await p.addInitScript(fakeCamera, [paper, false])
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: 'Scan pages' }).tap()
  const scanner = p.getByRole('dialog', { name: 'Scan pages' })
  await scanner.waitFor()
  const count = scanner.getByRole('status')
  await p.waitForSelector('[data-testid="scan-outline"]', { timeout: 15_000 })
  const outline = await p.locator('[data-testid="scan-outline"] polygon').evaluate((el) => {
    const box = el.ownerSVGElement.viewBox.baseVal
    return el
      .getAttribute('points')
      .split(' ')
      .map((pair) => pair.split(',').map(Number))
      .map(([x, y]) => [x / box.width, y / box.height])
  })
  const worst = (found, expected) =>
    Math.max(
      ...found.map(([x, y], i) =>
        Math.max(Math.abs(x - expected[i][0]), Math.abs(y - expected[i][1])),
      ),
    )
  const live = worst(outline, truth['paper-dark-table.jpg'])
  check(live <= 0.03, `the paper is outlined live (worst corner ${(live * 100).toFixed(1)}% off)`)
  await p.screenshot({ path: join(shots, 'scan-outline-phone.png') })
  await axe(p, 'scan camera')
  await count.filter({ hasText: '1 page taken' }).waitFor({ timeout: 10_000 })
  ok('a steady page is taken by itself')
  await p.waitForTimeout(3000)
  check(
    (await count.textContent()) === '1 page taken',
    'a page left under the camera is taken once',
    (await count.textContent()) ?? '',
  )
  // Turning the page: the hand covers it, then the next one lies there.
  await p.evaluate(() => {
    window.__scene = 'table'
  })
  await p.waitForTimeout(700)
  await p.evaluate(() => {
    window.__scene = 'paper'
  })
  await count.filter({ hasText: '2 pages taken' }).waitFor({ timeout: 10_000 })
  ok('turning to the next page takes it too')
  // Auto off: only the shutter takes a page.
  const autoButton = scanner.getByRole('button', { name: 'Auto' })
  await autoButton.tap()
  check((await autoButton.getAttribute('aria-pressed')) === 'false', 'Auto can be turned off')
  await p.evaluate(() => {
    window.__scene = 'table'
  })
  await p.waitForTimeout(500)
  await p.evaluate(() => {
    window.__scene = 'paper'
  })
  await p.waitForTimeout(2000)
  check(
    (await count.textContent()) === '2 pages taken',
    'with Auto off, a steady page waits for the shutter',
    (await count.textContent()) ?? '',
  )
  await scanner.getByRole('button', { name: 'Take the page' }).tap()
  await count.filter({ hasText: '3 pages taken' }).waitFor()
  ok('the shutter takes the page')
  const minSize = await scanner.getByRole('button', { name: 'Take the page' }).boundingBox()
  check((minSize?.width ?? 0) >= 44, 'the shutter is big enough for a thumb')
  check(
    (await p.evaluate(() => localStorage.getItem('collated:scan-auto'))) === 'off',
    'the Auto choice is remembered',
  )
  await scanner.getByRole('button', { name: 'Done' }).tap()
  await scanner.waitFor({ state: 'hidden' })
  await p.waitForSelector('ol[aria-label="3 pages"]', { timeout: 20_000 })
  check(
    await p.evaluate(() => {
      const v = document.querySelector('[data-testid="scan-video"]')
      return !v
    }),
    'Done closes the camera',
  )
  const labels = await p
    .locator('ol[aria-label="3 pages"] [data-page-select]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  check(
    labels.every((l, i) =>
      new RegExp(`^Page ${i + 1}: Scan \\d\\d\\.\\d\\d\\.\\d\\d( \\(\\d\\))?\\.jpg$`).test(l),
    ),
    'each page is named by when it was taken',
    labels.join(' | '),
  )
  // Each arrives cropped to the outline it was taken with.
  await p.getByRole('button', { name: labels[0] }).tap()
  const adjust = p.getByRole('button', { name: 'Adjust corners…' })
  await adjust.waitFor()
  await adjust.tap()
  const crop = p.getByRole('dialog', { name: 'Crop to the page' })
  await crop.waitFor()
  const found = []
  for (const name of ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']) {
    const at = await crop
      .getByRole('button', { name: `${name} corner`, exact: true })
      .evaluate(
        (el) =>
          document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      )
    const [x, y] = (at.match(/[\d.]+/g) ?? []).map((n) => Number(n) / 100)
    found.push([x, y])
  }
  const off = worst(found, truth['paper-dark-table.jpg'])
  check(
    off <= 0.03,
    `a scanned page arrives cropped to the paper (worst corner ${(off * 100).toFixed(1)}% off)`,
  )
  await p.keyboard.press('Escape')
  await crop.waitFor({ state: 'hidden' })
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - 390)
  check(overflow <= 0, 'Scan pages fits the phone toolbar', `${overflow}px`)
  await ctx.close()

  // Refused: Take photo is offered, and opens the system camera.
  const { context: denied, page: d } = await open(phone)
  await d.addInitScript(fakeCamera, [paper, true])
  await d.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await d.getByRole('button', { name: 'Scan pages' }).tap()
  const refused = d.getByRole('dialog', { name: 'Scan pages' })
  await refused.getByText('Collated wasn’t allowed to use the camera.').waitFor()
  await axe(d, 'scan camera refused')
  const [chooser] = await Promise.all([
    d.waitForEvent('filechooser'),
    refused.getByRole('button', { name: 'Take photo instead' }).tap(),
  ])
  check(
    (await chooser.element().getAttribute('capture')) === 'environment',
    'refused camera access offers Take photo instead',
  )
  await refused.waitFor({ state: 'hidden' })
  await denied.close()

  // Not offered with a mouse.
  const { context: desk, page: m } = await open({ viewport: { width: 1440, height: 1000 } })
  await m.goto(URL_ROOT, { waitUntil: 'networkidle' })
  check(
    (await m.getByRole('button', { name: 'Scan pages' }).count()) === 0,
    'Scan pages is not offered with a mouse',
  )
  await desk.close()

  // Chromium's fake camera, through the real browser path and headers.
  const camBrowser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  })
  const cam = await camBrowser.newContext({ ...phone, permissions: ['camera'] })
  const c = await watch(cam, await cam.newPage())
  await c.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await c.getByRole('button', { name: 'Scan pages' }).tap()
  await c.waitForFunction(
    () => (document.querySelector('[data-testid="scan-video"]')?.videoWidth ?? 0) > 0,
    undefined,
    { timeout: 15_000 },
  )
  ok('the browser camera opens under Permissions-Policy camera=(self)')
  const track = await c.evaluate(() => {
    const v = document.querySelector('[data-testid="scan-video"]')
    window.__track = v.srcObject.getVideoTracks()[0]
    return window.__track.readyState
  })
  check(track === 'live', 'the camera track is live while scanning', track)
  await c.getByRole('button', { name: 'Close the camera' }).tap()
  await c.getByRole('dialog', { name: 'Scan pages' }).waitFor({ state: 'hidden' })
  const after = await c
    .waitForFunction(() => window.__track.readyState === 'ended', undefined, { timeout: 3000 })
    .then(
      () => 'ended',
      () => c.evaluate(() => window.__track.readyState),
    )
  check(after === 'ended', 'closing the scanner stops the camera', after)
  await cam.close()
  await camBrowser.close()
}

checkSameOrigin()
await browser.close()
server.close()

if (fails.length) {
  console.error(`\n${fails.length} problem(s):\n  - ${fails.join('\n  - ')}`)
  // In GitHub Actions, each failure is also an annotation on the check, so
  // it can be read without the job log.
  if (process.env.GITHUB_ACTIONS) {
    for (const f of fails) console.log(`::error title=verify::${f.replace(/\r?\n/g, ' ')}`)
  }
  process.exit(1)
}
console.log(`\nAll checks passed. Screenshots in ${shots}`)
