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
import { TASKS, taskAppUrl, taskUrl, type Task } from './src/components/tasks'

/**
 * The docs site: static pages built from `docs/*.md`, the same files Boards
 * shows, so there's one copy of every doc. No framework and no script beyond
 * the theme file every page loads: the pages fall under the app's CSP as
 * they are, and render with the app's stylesheet (its `.doc` styles).
 *
 * The task pages (#120, src/components/tasks.ts) and the sitemap are built
 * here too, with the same header, footer and rules; task pages also load
 * the page-view count (ADR 0015), since search is how people reach them.
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
      ['signing', 'Filling in and signing a page'],
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

const ORIGIN = 'https://collatedpdf.com'

const footerHtml = () =>
  FOOTER.map(
    (column) =>
      `<div><p class="label mb-3 text-ink-faint">${escape(column.title)}</p><ul class="flex flex-col gap-1">${column.links
        .map(
          (link) =>
            `<li><a class="inline-block py-1 text-sm text-ink-muted hover:text-ink" href="${link.href}"${link.external ? ' rel="noopener noreferrer"' : ''}>${escape(link.label)}</a></li>`,
        )
        .join('')}</ul></div>`,
  ).join('')

const FOOTER_GRID = 'mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-4'

const BUTTON =
  'inline-flex items-center rounded-full bg-accent font-medium text-on-accent hover:bg-[color-mix(in_oklab,var(--c-accent),var(--c-ink)_14%)]'

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
      .find(
        // A sentence: not a heading, the date line, a table or a list.
        (block) => block && !/^(#|\||[-*] |\d+\. |[*_]Last updated)/.test(block),
      )
      ?.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`]/g, '')
      .slice(0, 200) ?? `${spec.label}: Collated documentation.`

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

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(title)} · Collated</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="icon" href="${APP_URL}favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="${ORIGIN}${spec.url}" />
    <script src="${APP_URL}theme.js"></script>
    <link rel="stylesheet" href="${css}" />
  </head>
  <body>
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">Skip to content</a>
    <header class="border-b border-rule">
      <div class="mx-auto flex min-h-14 max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        <a href="${APP_URL}" class="text-xl leading-none font-semibold tracking-[-0.03em] text-ink lowercase">Collated</a>
        <span class="label text-ink-faint">Docs</span>
        <a href="${APP_URL}" class="ml-auto h-9 px-4 text-sm ${BUTTON}">Open Collated</a>
      </div>
    </header>
    <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
      <nav aria-label="Docs" class="mb-10 lg:mb-0">${nav}</nav>
      <main id="main" class="doc min-w-0">${body}</main>
    </div>
    <footer class="border-t border-rule">
      <div class="${FOOTER_GRID}">${footerHtml()}</div>
    </footer>
  </body>
</html>
`
  return { url: spec.url, title, html }
}

/**
 * One task page (#120): what it does, the button into the app with the task
 * ready, how to, the privacy promise, and the other tasks. Plain HTML, so it
 * reads without JavaScript and is indexed as it stands.
 */
export const renderTaskPage = (task: Task, css: string): RenderedPage => {
  const url = taskUrl(task)
  const app = taskAppUrl(task)
  const list = (items: readonly string[]) =>
    items.map((item) => `<li>${escape(item)}</li>`).join('')
  const others = TASKS.filter((t) => t !== task)
    .map(
      (t) =>
        `<li><a class="inline-flex min-h-11 items-center rounded-full border border-rule px-4 text-sm text-ink hover:bg-ink/[0.06]" href="${taskUrl(t)}">${escape(t.heading)}</a></li>`,
    )
    .join('')
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escape(task.title)} · Collated</title>
    <meta name="description" content="${escape(task.description)}" />
    <link rel="icon" href="${APP_URL}favicon.svg" type="image/svg+xml" />
    <link rel="canonical" href="${ORIGIN}${url}" />
    <meta property="og:title" content="${escape(task.title)}" />
    <meta property="og:description" content="${escape(task.description)}" />
    <meta property="og:url" content="${ORIGIN}${url}" />
    <meta property="og:type" content="website" />
    <script src="${APP_URL}theme.js"></script>
    <script src="${APP_URL}analytics.js" defer></script>
    <link rel="stylesheet" href="${css}" />
  </head>
  <body>
    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-paper focus:px-3 focus:py-2">Skip to content</a>
    <header class="border-b border-rule">
      <div class="mx-auto flex min-h-14 max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        <a href="${APP_URL}" class="text-xl leading-none font-semibold tracking-[-0.03em] text-ink lowercase">Collated</a>
        <a href="${DOCS_URL}" class="ml-auto inline-flex min-h-11 items-center rounded-full px-3 text-sm text-ink-muted hover:bg-ink/[0.06] hover:text-ink">Docs</a>
      </div>
    </header>
    <main id="main" class="mx-auto flex max-w-3xl flex-col gap-10 px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
      <section class="flex flex-col items-start gap-6">
        <h1 class="text-display font-semibold text-ink">${escape(task.heading)}</h1>
        <p class="max-w-xl text-lg leading-relaxed text-ink-muted">${escape(task.lead)}</p>
        <a href="${app}" class="min-h-12 px-6 text-base ${BUTTON}">${escape(task.action)}</a>
        <p class="label flex items-center gap-2 text-ink-faint"><span class="inline-block size-1.5 rounded-full bg-accent" aria-hidden="true"></span>Free · no account · nothing uploaded</p>
      </section>
      <section aria-labelledby="how" class="doc">
        <h2 id="how">How to</h2>
        <ol>${list(task.steps)}</ol>
      </section>
      <section aria-labelledby="know" class="doc">
        <h2 id="know">Good to know</h2>
        <ul>${list(task.notes)}</ul>
        <p>More in the guide: <a href="${DOCS_URL}${task.guide.slug}/">${escape(task.guide.label)}</a>.</p>
      </section>
      <section aria-labelledby="private" class="rounded-[1.125rem] bg-paper p-6 shadow-panel">
        <h2 id="private" class="text-lg font-semibold tracking-tight text-ink">Your files stay on this device</h2>
        <p class="mt-1.5 text-sm leading-relaxed text-ink-muted">Collated builds the PDF in your browser. Nothing you add is uploaded: there is no server that sees your files, no account and no cookies, only an anonymous count of page views and exports. Once it has loaded it works offline, and it’s open source under the MIT licence, so anyone can check. <a class="underline" href="${PRIVACY_URL}">Privacy notice</a></p>
      </section>
      <nav aria-labelledby="more">
        <h2 id="more" class="label mb-3 text-ink-faint">More with Collated</h2>
        <ul class="flex flex-wrap gap-2">${others}</ul>
      </nav>
    </main>
    <footer class="border-t border-rule">
      <div class="${FOOTER_GRID}">${footerHtml()}</div>
    </footer>
  </body>
</html>
`
  return { url, title: task.title, html }
}

/** Every public page, for search engines: the app, the task pages and the docs. */
export const sitemap = () => {
  const urls = [APP_URL, ...TASKS.map(taskUrl), ...PAGES.map((p) => p.url)]
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${ORIGIN}${url}</loc></url>`).join('\n')}
</urlset>
`
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
        const task = TASKS.find((t) => taskUrl(t) === path)
        if (path === `${base}sitemap.xml`) {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8')
          res.end(sitemap())
          return
        }
        if (!page && !task) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(page ? renderPage(page, cssUrl).html : task && renderTaskPage(task, cssUrl).html)
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
      for (const task of TASKS) {
        this.emitFile({
          type: 'asset',
          fileName: fileFor(base, taskUrl(task)),
          source: renderTaskPage(task, cssUrl).html,
        })
      }
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() })
    },
  }
}
