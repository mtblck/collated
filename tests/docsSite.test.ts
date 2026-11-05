// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGES, renderPage, renderTaskPage, sitemap } from '../docs-site'
import { FOOTER, SOURCE_URL } from '../src/components/links'
import { TASKS, taskAppUrl, taskFrom, taskUrl } from '../src/components/tasks'

const docs = join(import.meta.dirname, '..', 'docs')
const rendered = PAGES.map((page) => ({
  page,
  ...renderPage(page, '/assets/x.css'),
}))

describe('docs site', () => {
  it('publishes every guide page, and only the listed docs', () => {
    for (const page of PAGES) expect(existsSync(join(docs, page.source)), page.source).toBe(true)
    const guide = readdirSync(join(docs, 'guide')).map((f) => `guide/${f}`)
    for (const file of guide) {
      expect(
        PAGES.some((p) => p.source === file),
        `${file} isn't published`,
      ).toBe(true)
    }
    // Research notes stay internal.
    expect(PAGES.some((p) => p.source === 'research.md')).toBe(false)
  })

  it('turns links between docs into site URLs (a typo would point at GitHub)', () => {
    for (const { page, html } of rendered) {
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'))
      for (const [, href = ''] of main.matchAll(/href="([^"]+)"/g)) {
        expect(href, `${page.source} links to ${href}`).not.toMatch(/\.md(#|$)/)
        if (href.startsWith(SOURCE_URL)) expect(href).not.toContain('/docs/')
      }
    }
  })

  it('needs nothing the CSP forbids: no inline scripts, styles or event handlers', () => {
    for (const { page, html } of rendered) {
      for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
        expect(tag, page.source).toMatch(/\ssrc="\/theme\.js"/)
      }
      expect(html, page.source).not.toMatch(/\son[a-z]+=|<style|\sstyle=/i)
    }
  })

  it('gives each page a title, one h1, a description and lang', () => {
    for (const { page, html, title } of rendered) {
      expect(html).toContain(`<title>${title} · Collated</title>`)
      expect(html.match(/<h1[\s>]/g), page.source).toHaveLength(1)
      expect(html).toMatch(/<meta name="description" content="[^"|]{20,}"/)
      expect(html).toContain('<html lang="en">')
      expect(html).toContain('aria-current="page"')
    }
  })

  it('privacy notice names what is stored and what the host sees', () => {
    const privacy = readFileSync(join(docs, 'privacy.md'), 'utf8')
    for (const fact of ['collated:settings', 'mb-theme', 'IndexedDB', 'Vercel', 'no cookies']) {
      expect(privacy.toLowerCase()).toContain(fact.toLowerCase())
    }
  })
})

describe('task pages (#120)', () => {
  const tasks = TASKS.map((task) => ({ task, ...renderTaskPage(task, '/assets/x.css') }))

  it('each has its own title, description, canonical URL and one h1', () => {
    const seen = { titles: new Set<string>(), descriptions: new Set<string>() }
    for (const { task, html } of tasks) {
      expect(html).toContain(`<title>${task.title} · Collated</title>`)
      expect(html).toContain(
        `<link rel="canonical" href="https://collatedpdf.com/${task.slug}/" />`,
      )
      expect(html.match(/<h1[\s>]/g), task.slug).toHaveLength(1)
      // What a search result shows: long enough to say something, short enough not to be cut.
      expect(task.description.length, task.slug).toBeGreaterThan(80)
      expect(task.description.length, task.slug).toBeLessThanOrEqual(160)
      seen.titles.add(task.title)
      seen.descriptions.add(task.description)
    }
    expect(seen.titles.size).toBe(TASKS.length)
    expect(seen.descriptions.size).toBe(TASKS.length)
  })

  it('opens the app with its task, and the app knows every task', () => {
    for (const { task, html } of tasks) {
      expect(html).toContain(`href="${taskAppUrl(task)}"`)
      expect(taskFrom(new URL(taskAppUrl(task), 'https://collatedpdf.com').search)).toBe(task)
    }
    expect(taskFrom('?task=nonsense')).toBeNull()
    expect(taskFrom('')).toBeNull()
  })

  it('loads only our own scripts, inline nothing, and links only to published pages', () => {
    const published = new Set([
      '/',
      ...PAGES.map((p) => p.url),
      ...TASKS.map(taskUrl),
      ...TASKS.map(taskAppUrl),
    ])
    for (const { task, html } of tasks) {
      const scripts = (html.match(/<script\b[^>]*>/gi) ?? []).map(
        (tag) => /src="([^"]+)"/.exec(tag)?.[1],
      )
      expect(scripts, task.slug).toEqual(['/theme.js', '/analytics.js'])
      expect(html, task.slug).not.toMatch(/\son[a-z]+=|<style|\sstyle=/i)
      for (const [, href = ''] of html.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|#)/.test(href) || href.startsWith('/assets/') || href === '/favicon.svg')
          continue
        expect(published.has(href), `${task.slug} links to ${href}`).toBe(true)
      }
    }
  })

  it('every guide page a task points to exists', () => {
    for (const task of TASKS) {
      expect(existsSync(join(docs, 'guide', `${task.guide.slug}.md`)), task.slug).toBe(true)
    }
  })

  it('are linked from the footer, and listed in the sitemap with every docs page', () => {
    const footer = FOOTER.flatMap((column) => column.links.map((link) => link.href))
    const map = sitemap()
    for (const task of TASKS) {
      expect(footer).toContain(taskUrl(task))
      expect(map).toContain(`<loc>https://collatedpdf.com/${task.slug}/</loc>`)
    }
    for (const page of PAGES) expect(map).toContain(`<loc>https://collatedpdf.com${page.url}</loc>`)
    expect(map).toContain('<loc>https://collatedpdf.com/</loc>')
    expect(readFileSync(join(docs, '..', 'public', 'robots.txt'), 'utf8')).toContain(
      'Sitemap: https://collatedpdf.com/sitemap.xml',
    )
  })
})
