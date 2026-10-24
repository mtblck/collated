import { describe, expect, it } from 'vitest'
import {
  INBOX_CACHE,
  inInbox,
  inboxKey,
  offlinePage,
  onDemandCache,
  routeFor,
  shellCache,
  staleCaches,
  type SwManifest,
} from './routes'

const ORIGIN = 'https://collatedpdf.com'
const manifest: SwManifest = {
  version: 'v2',
  shell: ['/', '/assets/index-abc.js', '/docs/', '/docs/keyboard/', '/theme.js'],
  onDemand: ['/ocr/worker.min.js', '/assets/libheif-x.wasm'],
  onDemandVersion: 'od1',
}
const route = (method: string, path: string, mode = 'cors', origin = ORIGIN) =>
  routeFor(manifest, { method, url: `${origin}${path}`, mode }, ORIGIN)

describe('service worker routes (#73)', () => {
  it('takes the share target POST, and only that POST', () => {
    expect(route('POST', '/share', 'navigate')).toBe('share')
    expect(route('POST', '/share?x=1', 'navigate')).toBe('share')
    expect(route('GET', '/share', 'navigate')).toBe('page')
    expect(route('POST', '/other')).toBe('network')
  })

  it('loads pages network first, whatever the path', () => {
    expect(route('GET', '/', 'navigate')).toBe('page')
    expect(route('GET', '/?share=abc', 'navigate')).toBe('page')
    expect(route('GET', '/docs/keyboard/', 'navigate')).toBe('page')
  })

  it('serves the build’s files from its caches, ignoring the query', () => {
    expect(route('GET', '/assets/index-abc.js')).toBe('shell')
    expect(route('GET', '/theme.js?v=1')).toBe('shell')
    expect(route('GET', '/ocr/worker.min.js')).toBe('on-demand')
    expect(route('GET', '/assets/libheif-x.wasm')).toBe('on-demand')
  })

  it('leaves everything else to the browser', () => {
    // An older build's chunk: the server's 404 is the honest answer (#42).
    expect(route('GET', '/assets/index-old.js')).toBe('network')
    expect(route('GET', '/licenses/Apache-2.0.txt')).toBe('network')
    expect(route('GET', '/assets/index-abc.js', 'cors', 'https://example.com')).toBe('network')
    expect(route('HEAD', '/assets/index-abc.js')).toBe('network')
  })

  it('falls back to the app offline, or the docs page asked for', () => {
    expect(offlinePage(manifest, '/')).toBe('/')
    expect(offlinePage(manifest, '/docs/keyboard/')).toBe('/docs/keyboard/')
    expect(offlinePage(manifest, '/some/deep/link')).toBe('/')
    // A file path in the shell isn't a page.
    expect(offlinePage(manifest, '/docs/missing/')).toBe('/')
  })

  it('deletes only its own caches from other builds, never the inbox', () => {
    const names = [
      shellCache(manifest),
      onDemandCache(manifest),
      'collated-shell-v1',
      'collated-on-demand-od0',
      INBOX_CACHE,
      'someone-else',
    ]
    expect(staleCaches(manifest, names)).toEqual(['collated-shell-v1', 'collated-on-demand-od0'])
  })

  it('keeps shared files apart by share, in order', () => {
    const keys = [inboxKey('a', 10), inboxKey('a', 2), inboxKey('b', 0)]
    expect(keys.filter((k) => inInbox('a', `${ORIGIN}${k}`)).sort()).toEqual([
      inboxKey('a', 2),
      inboxKey('a', 10),
    ])
    expect(inInbox('a', `${ORIGIN}${inboxKey('ab', 0)}`)).toBe(false)
  })
})
