// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGES, renderPage } from '../docs-site'
import { SOURCE_URL } from '../src/components/links'

const docs = join(import.meta.dirname, '..', 'docs')
const rendered = PAGES.map((page) => ({
  page,
  ...renderPage(page, '/tools/collated/assets/x.css'),
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
        expect(tag, page.source).toMatch(/\ssrc="\/tools\/collated\/theme\.js"/)
      }
      expect(html, page.source).not.toMatch(/\son[a-z]+=|<style|\sstyle=/i)
    }
  })

  it('gives each page a title, one h1, a description and lang', () => {
    for (const { page, html, title } of rendered) {
      expect(html).toContain(`<title>${title} · Collated</title>`)
      expect(html.match(/<h1[\s>]/g), page.source).toHaveLength(1)
      expect(html).toMatch(/<meta name="description" content="[^"]{20,}"/)
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
