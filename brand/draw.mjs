// Collated's logo and brand.json, drawn with the brand-kit plugin (brand-kit@mtblck 1.8.0).
//
// The mark is the one Collated has used since launch, redrawn on a 256 grid:
// two pages, one laid over the other, with an amber rule on the front page,
// the pages put in order. The back page stops a clear gap short of the front
// one (a real cut, no fill faking a hole), so it holds in one colour.
// The name is lower case Geist SemiBold, tracked −3 %, as in the app's header.
//
//   export BRAND_KIT=~/.claude/plugins/cache/mtblck/brand-kit/1.8.0/skills/logo
//   node brand/draw.mjs && node brand/portfolio/draw.mjs
//   node $BRAND_KIT/scripts/export.mjs brand/brand.json
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT =
  process.env.BRAND_KIT ||
  join(homedir(), '.claude/plugins/cache/mtblck/brand-kit/1.8.0/skills/logo')
const { loadFont, lockup, rect, svg, write } = await import(
  pathToFileURL(join(KIT, 'scripts/brand.mjs')).href
)
const { subtract, dilate } = await import(pathToFileURL(join(KIT, 'scripts/geometry.mjs')).href)

const here = dirname(fileURLToPath(import.meta.url))
const out = (f) => join(here, f)

// The app's own tokens (src/index.css), as hex.
export const C = {
  ink: '#15171b', // --c-ink, light theme
  paper: '#fcfdfe', // --c-paper, light theme
  ground: '#e8e9ec', // --c-ground, light theme
  amber: '#905100', // --c-accent, light theme
  lamp: '#ffb64f', // --c-accent, dark theme
  table: '#121417', // --c-ground, dark theme
  sheet: '#1e1f23', // --c-paper, dark theme
  chalk: '#edeef1', // --c-ink, dark theme
}

/**
 * The mark on the 256 grid. Pages are 128 × 164 (about Letter's shape),
 * the front one at (40, 64), the back one 48 right and 40 up. One band
 * width S for both outlines and the rule; one radius R; the back page is cut
 * a gap G clear of the front page's outer edge.
 */
function pages({ S = 20, G = 14, R = 10 } = {}) {
  const W = 128,
    H = 164
  const fx = 40,
    fy = 64,
    bx = 88,
    by = 24
  const box = (x, y) => rect(x, y, W, H, R)
  const inner = (x, y) => rect(x + S, y + S, W - 2 * S, H - 2 * S, Math.max(0, R - S))
  const front = subtract(box(fx, fy), inner(fx, fy))
  const back = subtract(box(bx, by), inner(bx, by), dilate(box(fx, fy), G))
  // The rule: across the front page's lower third, 20 in from the page's inner edges.
  const rule = rect(fx + S + 20, fy + H - 3 * S, W - 2 * S - 40, S)
  return { front, back, rule, x: 40, y: 24, w: 176, h: 204 }
}

const body = (p, line, accent) =>
  `<g transform="translate(${-p.x} ${-p.y})"><path d="${p.back}${p.front}" fill="${line}" fill-rule="evenodd"/><path d="${p.rule}" fill="${accent}"/></g>`

const P = pages()
const mark = (line, accent) => ({ body: body(P, line, accent), w: P.w, h: P.h })

write(out('mark.svg'), svg({ w: P.w, h: P.h, title: 'Collated', body: mark(C.ink, C.amber).body }))
write(
  out('mark-dark.svg'),
  svg({ w: P.w, h: P.h, title: 'Collated', body: mark(C.chalk, C.lamp).body }),
)

// Favicon: the same pages with heavier bands and a wider cut, so both pages
// still read at 16 px, on the dark table tile the app icon uses.
const F = pages({ S: 28, G: 18, R: 12 })
const fs = 0.78 * (256 / Math.max(F.w, F.h))
write(
  out('favicon.svg'),
  svg({
    w: 256,
    h: 256,
    title: 'Collated',
    body: `<rect width="256" height="256" rx="56" fill="${C.table}"/><g transform="translate(128 128) scale(${fs.toFixed(4)}) translate(${-F.w / 2} ${-F.h / 2})">${body(F, C.chalk, C.lamp)}</g>`,
  }),
)

const font = await loadFont('Geist', 600)
for (const [layout, file] of [
  ['horizontal', 'logo-horizontal'],
  ['stacked', 'logo-stacked'],
]) {
  for (const [suffix, line, accent] of [
    ['', C.ink, C.amber],
    ['-dark', C.chalk, C.lamp],
  ]) {
    const l = lockup({
      mark: mark(line, accent),
      font,
      name: 'collated',
      layout,
      color: line,
      tracking: -0.03,
    })
    write(out(`${file}${suffix}.svg`), svg({ w: l.w, h: l.h, title: 'Collated', body: l.body }))
  }
}

write(
  out('brand.json'),
  JSON.stringify(
    {
      name: 'Collated',
      shortName: 'Collated',
      tagline: 'Photos and scans into one PDF, on your device.',
      about:
        'Collated turns phone photos, scans and PDFs into one tidy PDF in the browser. Nothing is uploaded: the pages are put in order, straightened and exported on your own device.\n\nThe mark is two pages, one laid over the other, with an amber rule on the front one: the moment loose pages become a set.',
      construction:
        'On a 256 grid: two 128 × 164 pages with one 20-unit band and a 10-unit radius, the back one offset 48 right and 40 up and cut 14 clear of the front, and a 20-unit amber rule across the front page.',
      website: 'collatedpdf.com',
      direction: {
        words: ['calm', 'exact', 'private'],
        pairs: { tone: 'serious', era: 'modern', volume: 'quiet', finish: 'crisp' },
        references: {
          like: ['a light table', 'Swiss utility'],
          avoid: ['cloud badges', 'gradients'],
        },
        lives: 'app',
        weirdness: 1,
      },
      colors: [
        {
          name: 'Ink',
          hex: C.ink,
          role: 'primary',
          usage: 'The wordmark, the mark and body text on light grounds.',
        },
        {
          name: 'Amber',
          hex: C.amber,
          role: 'accent',
          usage:
            'The rule in the mark and one highlight per layout on light grounds; links and the selected state in the app.',
        },
        {
          name: 'Paper',
          hex: C.paper,
          role: 'paper',
          usage: 'Pages, panels and light backgrounds.',
        },
        {
          name: 'Light table',
          hex: C.table,
          role: 'dark',
          usage: 'Dark grounds, the app icon tile and the dark theme.',
        },
        {
          name: 'Lamp',
          hex: C.lamp,
          role: 'accent-dark',
          usage: 'Amber on dark grounds, where Amber is too dim.',
        },
        {
          name: 'Ground',
          hex: C.ground,
          role: 'support',
          usage: 'The light theme’s work area behind the pages.',
        },
      ],
      type: {
        display: { family: 'Geist', weight: 600 },
        text: { family: 'Geist', weight: 400 },
      },
      logos: {
        mark: { file: 'mark.svg', dark: 'mark-dark.svg', minWidth: 16 },
        horizontal: { file: 'logo-horizontal.svg', dark: 'logo-horizontal-dark.svg', minWidth: 96 },
        stacked: { file: 'logo-stacked.svg', dark: 'logo-stacked-dark.svg', minWidth: 64 },
      },
      icon: {
        file: 'mark-dark.svg',
        background: C.table,
        favicon: 'favicon.svg',
        themeColor: C.paper,
      },
      clearSpace: 0.25,
      templates: { background: C.table },
      palette: { brand: C.ink, accent: C.amber, neutral: C.ink },
      legal: {
        owner: 'Matt Black',
        contact: 'https://github.com/mtblck/collated/issues',
        codeLicense: 'MIT',
      },
      portfolio: {
        cover: 'portfolio/cover.svg',
        mobile: 'portfolio/cover-mobile.svg',
        alt: 'On a dark light table, a loose scatter of tilted photos and scans slides toward the middle, where the same pages lie squared into one neat stack, the top page marked with an amber rule.',
      },
      exports: 'all',
      out: 'dist',
    },
    null,
    2,
  ) + '\n',
)
