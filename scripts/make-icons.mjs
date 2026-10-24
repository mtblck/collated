/**
 * Draws the app icons the manifest lists (#73) from the favicon's design, in
 * Chromium, so they stay one picture. Run after changing public/favicon.svg:
 *
 *   node scripts/make-icons.mjs
 *
 * "any" icons keep the favicon's rounded square; the maskable one fills its
 * square edge to edge and keeps the stack inside the middle 80%, the safe
 * zone every launcher's mask leaves alone.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8')
const BG = /<rect width="64" height="64" rx="6" fill="([^"]+)"\/>/.exec(favicon)?.[1]
if (!BG) throw new Error('favicon.svg no longer starts with its background square')

// The favicon's drawing without its background, scaled about the centre.
const art = favicon
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect width="64" height="64"[^>]*\/>/, '')
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BG}"/><g transform="translate(32 32) scale(0.8) translate(-32 -32)">${art}</g></svg>`

const icons = [
  { file: 'icon-192.png', size: 192, svg: favicon },
  { file: 'icon-512.png', size: 512, svg: favicon },
  { file: 'icon-maskable-512.png', size: 512, svg: maskable },
  // iOS ignores the manifest's icons and masks this one itself.
  { file: 'apple-touch-icon.png', size: 180, svg: maskable },
]

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
)
const page = await browser.newPage()
for (const { file, size, svg } of icons) {
  await page.setViewportSize({ width: size, height: size })
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style><img src="${src}" width="${size}" height="${size}" style="display:block">`,
  )
  await page.waitForFunction(() => document.images[0]?.complete)
  writeFileSync(
    join(root, 'public', 'icons', file),
    await page.screenshot({ omitBackground: true, type: 'png' }),
  )
  console.log(`public/icons/${file}`)
}
await browser.close()
