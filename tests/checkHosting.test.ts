// @vitest-environment node
/**
 * Mutation tests for scripts/check-hosting.js: each loosening of vercel.json
 * that the check exists to catch is applied to a copy, and the check must
 * fail on it, naming the problem.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')
const script = join(root, 'scripts', 'check-hosting.js')
const dir = mkdtempSync(join(tmpdir(), 'collated-hosting-'))

interface Header {
  key: string
  value: string
}
interface Config {
  headers: { source: string; headers: Header[] }[]
}
const original = readFileSync(join(root, 'vercel.json'), 'utf8')

const run = (mutate?: (config: Config) => void) => {
  const config = JSON.parse(original) as Config
  mutate?.(config)
  const file = join(dir, `vercel-${String(Math.random()).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(config))
  const result = spawnSync(process.execPath, [script, file], { encoding: 'utf8' })
  return { status: result.status, output: result.stdout + result.stderr }
}

const headers = (config: Config) => {
  const block = config.headers.find((b) => b.source === '/tools/collated/(.*)')
  if (!block) throw new Error('no header block')
  return block.headers
}
const setHeader = (key: string, value: string | null) => (config: Config) => {
  const list = headers(config)
  const index = list.findIndex((h) => h.key === key)
  if (value === null) list.splice(index, 1)
  else if (index >= 0) list[index] = { key, value }
  else list.push({ key, value })
}
const csp = (edit: (policy: string) => string) => (config: Config) => {
  const header = headers(config).find((h) => h.key === 'Content-Security-Policy')
  if (!header) throw new Error('no CSP')
  header.value = edit(header.value)
}
const replace = (from: string, to: string) =>
  csp((policy) => {
    if (!policy.includes(from)) throw new Error(`CSP lacks ${from}`)
    return policy.replace(from, to)
  })

describe('hosting:check', () => {
  it('passes the real vercel.json', () => {
    expect(run()).toMatchObject({ status: 0 })
  })

  it.each([
    ['script-src gains unsafe-eval', replace("'wasm-unsafe-eval'", "'unsafe-eval'"), 'script-src'],
    [
      'script-src gains a host',
      replace("script-src 'self'", "script-src 'self' https://cdn.example"),
      'script-src',
    ],
    [
      'script-src gains unsafe-inline',
      replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      'script-src',
    ],
    [
      'worker-src allows blob:',
      replace("worker-src 'self'", "worker-src 'self' blob:"),
      'worker-src',
    ],
    ['worker-src goes missing', replace("worker-src 'self'; ", ''), 'worker-src'],
    [
      'connect-src allows a host',
      replace("connect-src 'self'", "connect-src 'self' https:"),
      'connect-src',
    ],
    ['default-src widens', replace("default-src 'self'", 'default-src *'), 'default-src'],
    ['object-src is dropped', replace("; object-src 'none'", ''), 'object-src'],
    ['base-uri widens', replace("base-uri 'self'", 'base-uri *'), 'base-uri'],
    ['form-action allows self', replace("form-action 'none'", "form-action 'self'"), 'form-action'],
    [
      'frame-ancestors allows self',
      replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
      'frame-ancestors',
    ],
    ['img-src allows any https', replace('img-src', 'img-src https:'), 'img-src'],
    ['a new directive is added', csp((p) => `${p}; media-src *`), 'media-src'],
    ['a directive is repeated', csp((p) => `script-src *; ${p}`), 'twice'],
    [
      'the CSP header is removed',
      setHeader('Content-Security-Policy', null),
      'Content-Security-Policy',
    ],
    ['nosniff is removed', setHeader('X-Content-Type-Options', null), 'X-Content-Type-Options'],
    ['X-Frame-Options weakens', setHeader('X-Frame-Options', 'SAMEORIGIN'), 'X-Frame-Options'],
    ['Referrer-Policy weakens', setHeader('Referrer-Policy', 'unsafe-url'), 'Referrer-Policy'],
    [
      'COOP is removed',
      setHeader('Cross-Origin-Opener-Policy', null),
      'Cross-Origin-Opener-Policy',
    ],
    [
      'HSTS is shortened',
      setHeader('Strict-Transport-Security', 'max-age=60'),
      'Strict-Transport-Security',
    ],
    ['HSTS is removed', setHeader('Strict-Transport-Security', null), 'Strict-Transport-Security'],
    [
      'camera is allowed',
      setHeader('Permissions-Policy', 'microphone=(), geolocation=()'),
      'camera',
    ],
    [
      'a second block loosens the CSP',
      (config: Config) => {
        config.headers.push({
          source: '/(.*)',
          headers: [{ key: 'Content-Security-Policy', value: 'default-src *' }],
        })
      },
      'security headers belong only',
    ],
    [
      'the assets block adds CORS',
      (config: Config) => {
        config.headers
          .find((b) => b.source === '/tools/collated/assets/(.*)')
          ?.headers.push({ key: 'Access-Control-Allow-Origin', value: '*' })
      },
      'Access-Control-Allow-Origin',
    ],
  ])('fails when %s', (_, mutate, mentions) => {
    const { status, output } = run(mutate)
    expect(status).toBe(1)
    expect(output).toContain(mentions)
  })
})
