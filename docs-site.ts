import { readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Marked, type Tokens } from 'marked'
import type { Plugin } from 'vite'
import {
  APP_URL,
  DOCS_URL,
  FOOTER,
  PRIVACY_URL,
  SOURCE_URL,
  TERMS_URL,
} from './src/components/links'

/**
 * The docs site: static pages built from `docs/*.md`, the same files Boards
 * shows, so there's one copy of every doc. No framework and no script beyond
 * the theme file every page loads: the pages fall under the app's CSP as
 * they are, and render with the app's stylesheet (its `.doc` styles).
 *
 * Only the files listed in PAGES are published. Anything else in docs/
 * (research notes) stays internal. Relative links between published docs
 * become site URLs; links to other repo files point at GitHub.
 */
const ROOT = import.meta.dirname
const REPO_BLOB = `${SOURCE_URL}/blob/main/`

interface PageSpec {
  /** Path under docs/. */
  source: string
  /** Published URL (under the base). */
  url: string
  /** Sidebar label; the page's own `#` heading is its title. */
  label: string
  group: 'Guide' | 'Legal'
}

export const PAGES: readonly PageSpec[] = [
  { source: 'guide.md', url: DOCS_URL, label: 'Using Collated', group: 'Guide' },
  ...(
    [
      ['getting-started', 'Getting started'],
      ['adding-pages', 'Adding pages'],
      ['arranging-pages', 'Arranging pages'],
      ['page-setup', 'Page setup'],
      ['exporting', 'Exporting'],
      ['keyboard', 'Keyboard'],
      ['privacy-and-security', 'Privacy and security'],
      ['troubleshooting', 'Troubleshooting'],
    ] as const
  ).map(([slug, label]) => ({
    source: `guide/${slug}.md`,
    url: `${DOCS_URL}${slug}/`,
    label,
    group: 'Guide' as const,
  })),
  { source: 'privacy.md', url: PRIVACY_URL, label: 'Privacy notice', group: 'Legal' },
  { source: 'terms.md', url: TERMS_URL, label: 'Terms of use', group: 'Legal' },
]

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

const stripFrontmatter = (markdown: string) => markdown.replace(/^---\n[\s\S]*?\n---\n/, '')

/** A docs-relative link target → its site URL, or the file on GitHub. */
const resolveLink = (from: string, href: string) => {
  if (/^[a-z]+:|^#|^\//i.test(href)) return href
  const [path = '', hash] = href.split('#')
  const target = posix.normalize(posix.join(posix.dirname(from), path))
  const page = PAGES.find((p) => p.source === target)
  const url = page ? page.url : `${REPO_BLOB}${posix.normalize(posix.join('docs', target))}`
  return hash ? `${url}#${hash}` : url
}

export interface RenderedPage {
  url: string
  title: string
  html: string
}

/** Renders one page's HTML; `css` is the app stylesheet's URL. */
export const renderPage = (spec: PageSpec, css: string): RenderedPage => {
  const markdown = stripFrontmatter(readFileSync(join(ROOT, 'docs', spec.source), 'utf8'))
  const title = /^# (.+)$/m.exec(markdown)?.[1]?.trim() ?? spec.label
  const description =
    markdown
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .find((block) => block && !block.startsWith('#') && !/^[*_]Last updated/.test(block))
      ?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .slice(0, 200) ?? ''

  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === 'link') {
        const link = token as Tokens.Link
        link.href = resolveLink(spec.source, link.href)
      }
    },
    renderer: {
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens)
        const rel = /^https?:/i.test(href) ? ' rel="noopener noreferrer"' : ''
        return `<a href="${escape(href)}"${rel}>${inner}</a>`
      },
    },
  })
  const body = marked.parse(markdown, { async: false })

  const nav = (['Guide', 'Legal'] as const)
    .map((group) => {
      const items = PAGES.filter((p) => p.group === group)
        .map((p) => {
          const current = p.url === spec.url
          return `<li><a href="${p.url}" class="doc-nav-link"${current ? ' aria-current="page"' : ''}>${escape(p.label)}</a></li>`
        })
        .join('')
      return `<p class="label mb-2 text-ink-faint">${group}</p><ul class="mb-8 flex flex-col gap-0.5">${items}</ul>`
    })
    .join('')

  const footer = FOOTER.map(
    (column) =>
      `<div><p class="label mb-3 text-ink-faint">${escape(column.title)}</p><ul class="flex flex-col gap-2">${column.links
        .map(
          (link) =>
            `<li><a class="text-sm text-ink-muted hover:text-ink" href="${link.href}"${link.external ? ' rel="noopener noreferrer"' : ''}>${escape(link.label)}</a></li>`,
        )
        .join('')}</ul></div>`,
  ).join('')

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)} · Collated</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="icon" href="${APP_URL}favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="https://mattblack.space${spec.url}" />
    <script src="${APP_URL}theme.js"></script>
    <link rel="stylesheet" href="${css}" />
  </head>
  <body>
    <div class="grain pointer-events-none fixed inset-0 -z-10" aria-hidden="true"></div>
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">Skip to content</a>
    <header class="border-b border-rule bg-paper">
      <div class="mx-auto flex min-h-14 max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        <a href="${APP_URL}" class="font-display text-[1.75rem] leading-none text-ink">Collated</a>
        <span class="label text-ink-faint">Docs</span>
        <a href="${APP_URL}" class="ml-auto inline-flex h-9 items-center rounded-[2px] bg-ink px-3.5 text-sm font-medium text-paper hover:bg-ink/85">Open Collated</a>
      </div>
    </header>
    <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
      <nav aria-label="Docs" class="mb-10 lg:mb-0">${nav}</nav>
      <main id="main" class="doc min-w-0">${body}</main>
    </div>
    <footer class="border-t border-rule">
      <div class="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">${footer}</div>
    </footer>
  </body>
</html>
`
  return { url: spec.url, title, html }
}

/** The output file for a URL under the base: `docs/exporting/index.html`. */
const fileFor = (base: string, url: string) => `${url.slice(base.length)}index.html`

export const docsSite = (base: string): Plugin => {
  let cssUrl = `${base}src/index.css`
  return {
    name: 'collated-docs-site',
    // Rebuild when a doc changes in dev.
    configureServer(server) {
      server.watcher.add(join(ROOT, 'docs'))
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const page = PAGES.find((p) => p.url === path)
        if (!page) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(renderPage(page, cssUrl).html)
      })
    },
    generateBundle(_options, bundle) {
      const css = Object.values(bundle).find(
        (file) => file.type === 'asset' && file.fileName.endsWith('.css'),
      )
      if (!css) this.error('docs-site: no stylesheet in the bundle')
      cssUrl = `${base}${css.fileName}`
      for (const page of PAGES) {
        this.emitFile({
          type: 'asset',
          fileName: fileFor(base, page.url),
          source: renderPage(page, cssUrl).html,
        })
      }
    },
  }
}
