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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { PDFDocument } from '@cantoo/pdf-lib'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const fixtures = join(root, 'tests', 'fixtures')
const shots = join(root, process.env.SHOTS ?? 'shots')
mkdirSync(shots, { recursive: true })
const BASE = '/tools/collated/'
const PORT = Number(process.env.VERIFY_PORT ?? 4175)
const URL_ROOT = `http://localhost:${PORT}${BASE}`

if (!existsSync(join(dist, 'tools', 'collated', 'index.html'))) {
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
}
const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0])
  if (path === '/tools/collated') {
    res.writeHead(308, { Location: BASE }).end()
    return
  }
  let file = join(dist, path)
  if (!path.startsWith(BASE) || !existsSync(file) || !extname(file)) {
    file = join(dist, 'tools', 'collated', 'index.html') // SPA fallback
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
const check = (condition, message, detail = '') => {
  if (condition) ok(message)
  else fails.push(`${message}${detail ? `\n      ${detail}` : ''}`)
}

const open = async (options = {}) => {
  const context = await browser.newContext({ acceptDownloads: true, ...options })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') fails.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => fails.push(`pageerror: ${e.message}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)
    })
  })
  return { context, page }
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

const compareImages = async (a, b) => {
  const compare = await browser.newPage()
  try {
    return await compare.evaluate(
      async ([srcA, srcB]) => {
        const load = (src) =>
          new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve(img)
            img.src = `data:image/png;base64,${src}`
          })
        const [ia, ib] = await Promise.all([load(srcA), load(srcB)])
        const W = 120
        const H = Math.round((W * ia.height) / ia.width)
        const pixels = (img) => {
          const c = document.createElement('canvas')
          c.width = W
          c.height = H
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0, W, H)
          return ctx.getImageData(0, 0, W, H).data
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
      [a, b],
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
await page.getByLabel('Page size').selectOption('letter')
await page.getByLabel('Margin').fill('0.5')
await page.getByLabel('Margin').blur()
await page.getByLabel('Title & filename').fill('Verify run')
await page.screenshot({ path: join(shots, 'inspector.png'), fullPage: true })

// Export and inspect the PDF.
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: /Export PDF/ }).click(),
])
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

  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: /Export PDF/ }).click(),
  ])
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

// 4. Filters: greyscale and B&W, preview matching export. ---------------------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles(
    '[data-testid="file-input"]',
    ['quad-landscape.jpg', 'quad-exif6.jpg', 'doc-photo.jpg'].map((f) => join(fixtures, f)),
  )
  await p.waitForSelector('ol[aria-label="3 pages"]')
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
  await p.screenshot({ path: join(shots, 'filters.png'), fullPage: true })

  const [dl] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: /Export PDF/ }).click(),
  ])
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
    const [bwRender, greyRender] = ['1', '2'].map((n) =>
      readFileSync(`${prefix}-${n}.png`).toString('base64'),
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
      async ([bwSrc, greySrc]) => {
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
        const [b, gr] = await Promise.all([read(bwSrc), read(greySrc)])
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
        return { notBinary: notBinary / (b.length / 4), coloured: coloured / (gr.length / 4) }
      },
      [bwRender, greyRender],
    )
    check(
      tones.notBinary < 0.01,
      `B&W page is black and white (${(tones.notBinary * 100).toFixed(2)}% mid-tones)`,
    )
    check(
      tones.coloured < 0.01,
      `greyscale page has no colour (${(tones.coloured * 100).toFixed(2)}% coloured)`,
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
    const [d] = await Promise.all([
      p.waitForEvent('download'),
      p.getByRole('button', { name: /Export PDF/ }).click(),
    ])
    const path = join(mkdtempSync(join(tmpdir(), 'collated-verify-size-')), name)
    await d.saveAs(path)
    await p.getByRole('button', { name: /Export PDF/ }).waitFor({ state: 'visible' })
    await p.waitForFunction(() => !/Building|Shrinking/.test(document.body.innerText))
    return { path, bytes: readFileSync(path).byteLength }
  }
  const original = await exportAndMeasure('original.pdf')

  // The real popover: opened by its button, closed with Escape.
  const optionsButton = p.getByRole('button', { name: /Export options/ })
  await optionsButton.click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  check(await dialog.isVisible(), 'export options open in a popover')
  await axe(p, 'export options')
  await dialog.getByRole('radio', { name: /Small/ }).check()
  const estimateLabel = (await optionsButton.textContent()) ?? ''
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
  await p.getByLabel('Margin').fill('0.5')
  await p.getByLabel('Margin').blur()
  const optionsButton = p.getByRole('button', { name: /Export options/ })
  await optionsButton.click()
  const dialog = p.getByRole('dialog', { name: 'Export options' })
  await dialog.getByRole('checkbox', { name: 'Page numbers' }).check()
  await dialog.getByLabel('Position').selectOption('bottom-right')
  await dialog.getByLabel('Password to open').fill('correct horse')
  await axe(p, 'export options with numbers and password')
  await dialog.getByRole('button', { name: 'Export locked PDF' }).click()
  const [locked] = await Promise.all([p.waitForEvent('download')])
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
  await p.getByLabel('Page size').selectOption('image')
  await p.getByLabel('Image dpi').fill('150')
  await p.getByLabel('Image dpi').blur()
  await optionsButton.click()
  await dialog.getByLabel('Password to open').fill('')
  await dialog.getByRole('button', { name: 'Export PDF' }).click()
  const [matched] = await Promise.all([p.waitForEvent('download')])
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
  const [d] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: /Export PDF/ }).click(),
  ])
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

  const [d] = await Promise.all([
    p.waitForEvent('download'),
    p.getByRole('button', { name: /Export PDF/ }).click(),
  ])
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

// 10. OCR: a sideways photo of a page, turned upright, made searchable. -------
{
  const { context: ctx, page: p } = await open({ viewport: { width: 1440, height: 1000 } })
  await p.goto(URL_ROOT, { waitUntil: 'networkidle' })
  await p.setInputFiles('[data-testid="file-input"]', [join(fixtures, 'text-page-sideways.jpg')])
  await p.waitForSelector('ol[aria-label="1 page"]')
  await p.getByRole('button', { name: 'Rotate page 1 right' }).click({ force: true })
  await p.getByRole('button', { name: /Export options/ }).click()
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
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
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

  // The export button keeps focus while it's busy and after.
  const exportButton = p.getByRole('button', { name: /^Export PDF · / })
  await exportButton.focus()
  const [dl] = await Promise.all([p.waitForEvent('download'), p.keyboard.press('Enter')])
  await dl.path()
  await p.waitForFunction(() => /Saved/.test(document.getElementById('status')?.textContent ?? ''))
  check(
    /^Export PDF · /.test(await focused()),
    'the export button keeps focus through the export',
    await focused(),
  )

  // Export options: a too-long password is refused inline; Tab out closes it.
  await p.getByRole('button', { name: /Export options/ }).click()
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
    (await p.getByRole('button', { name: /^Export locked PDF · / }).count()) === 1,
    'the main export button says the PDF will be locked',
  )
  await p.getByRole('button', { name: /Export options/ }).click()
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

await browser.close()
server.close()

if (fails.length) {
  console.error(`\n${fails.length} problem(s):\n  - ${fails.join('\n  - ')}`)
  process.exit(1)
}
console.log(`\nAll checks passed. Screenshots in ${shots}`)
