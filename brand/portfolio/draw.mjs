// Collated's portfolio covers: one scene, drawn twice (2400 × 800 and 1000 × 800).
//
// Verb: Collated *puts loose pages in order*. Picture, straight top-down on the
// app's dark light table: a loose scatter of tilted photos and scans on the
// left slides toward the middle, where the same pages lie squared into one
// stack. The amber rule (the mark's accent) is only on the stack's top page.
//
//   node brand/portfolio/draw.mjs     writes cover.svg and cover-mobile.svg here
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const KIT =
  process.env.BRAND_KIT ||
  join(homedir(), '.claude/plugins/cache/mtblck/brand-kit/1.8.0/skills/logo')
const { svg, write } = await import(pathToFileURL(join(KIT, 'scripts/brand.mjs')).href)

const here = dirname(fileURLToPath(import.meta.url))
const C = {
  table: '#121417', // dark ground
  lit: '#1a1c20', // the lit patch of the table, a step lighter
  paper: '#fcfdfe',
  shade: '#e8e9ec', // the paper's ground tone, for photo areas
  ink: '#15171b',
  stone: '#b9bcc2', // greys printed on the pages
  lamp: '#ffb64f',
}

const PW = 150,
  PH = 194 // a page, about Letter's shape

/** A page whose content is either a photo (a picture block) or a scan (text lines). */
function page(kind, i) {
  const r = 6
  let art = ''
  if (kind === 'photo') {
    art += `<rect x="16" y="16" width="${PW - 32}" height="${PH - 72}" rx="3" fill="${C.shade}"/>`
    // A simple horizon picture: a hill and a sun, in greys.
    const hy = 16 + (PH - 72) * 0.62
    art += `<path d="M16 ${hy + 18}Q${PW * 0.35} ${hy - 26} ${PW * 0.6} ${hy + 4}T${PW - 16} ${hy - 6}V${PH - 56}H16Z" fill="${C.stone}"/>`
    art += `<circle cx="${PW * 0.7}" cy="${16 + 30 + (i % 2) * 8}" r="12" fill="${C.stone}"/>`
  } else {
    const widths = [0.72, 0.9, 0.84, 0.9, 0.6, 0.88, 0.78, 0.5]
    widths.forEach((w, k) => {
      art += `<rect x="18" y="${24 + k * 18}" width="${((PW - 36) * w).toFixed(1)}" height="7" rx="3.5" fill="${C.stone}"/>`
    })
  }
  return `<g id="p${i}"><rect width="${PW}" height="${PH}" rx="${r}" fill="${C.paper}"/>${art}</g>`
}

const kinds = ['photo', 'scan', 'photo', 'scan', 'scan', 'photo', 'scan']
const defs = `<defs>${kinds.map((k, i) => page(k, i)).join('')}</defs>`
const use = (i, x, y, a, s = 1) =>
  `<g transform="translate(${x} ${y}) rotate(${a}) scale(${s}) translate(${-PW / 2} ${-PH / 2})"><rect x="6" y="10" width="${PW}" height="${PH}" rx="6" fill="#000" opacity="0.12"/><use href="#p${i}"/></g>`

function scene(W, H, { loose, stack, s, title }) {
  const cx = W / 2,
    cy = H / 2 - 10
  const parts = [`<rect width="${W}" height="${H}" fill="${C.table}"/>`]
  // The lit patch of the table: one large soft-cornered rectangle, a step lighter.
  parts.push(
    `<rect x="${cx - W * 0.31}" y="70" width="${W * 0.62}" height="${H - 140}" rx="48" fill="${C.lit}"/>`,
  )
  parts.push(defs)
  // Loose pages, drifting in from the left at angles.
  for (const [i, dx, dy, a] of loose) parts.push(use(i, cx + dx * s, cy + dy * s, a, s))
  // The stack: pages squared on one another, each a few units lower and right.
  const [sx, sy] = stack
  for (let k = 4; k >= 1; k--)
    parts.push(use(k, cx + sx * s + k * 7 * s, cy + sy * s + k * 7 * s, 0, s))
  // Top page: a blank sheet with the amber rule, as in the mark.
  const tx = cx + sx * s - (PW * s) / 2,
    ty = cy + sy * s - (PH * s) / 2
  parts.push(
    `<g transform="translate(${tx} ${ty}) scale(${s})"><rect x="6" y="10" width="${PW}" height="${PH}" rx="6" fill="#000" opacity="0.12"/><use href="#p0"/><rect x="34" y="${PH - 46}" width="${PW - 68}" height="18" fill="${C.lamp}"/></g>`,
  )
  return svg({ w: W, h: H, title, body: parts.join('') })
}

const alt =
  'On a dark light table, a loose scatter of tilted photos and scans slides toward the middle, where the same pages lie squared into one neat stack, the top page marked with an amber rule.'

write(
  join(here, 'cover.svg'),
  scene(2400, 800, {
    title: alt,
    s: 1.5,
    loose: [
      [1, -380, -50, -14],
      [2, -270, 80, 9],
      [3, -150, -40, -6],
      [5, -40, 70, 4],
    ],
    stack: [300, -10],
  }),
)
write(
  join(here, 'cover-mobile.svg'),
  scene(1000, 800, {
    title: alt,
    s: 1.1,
    loose: [
      [1, -175, -95, -14],
      [2, -165, 120, 10],
      [3, -40, 10, -5],
    ],
    stack: [165, -5],
  }),
)
console.log('alt:', alt)
