// @vitest-environment node
/**
 * scripts/changelog.mjs (npm run changelog:check): passes a good CHANGELOG.md, and
 * fails on a missing Unreleased, a wrong or empty heading, or a leftover changelog.d/
 * fragment, naming what to fix.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(import.meta.dirname, '..', 'scripts', 'changelog.mjs')

const GOOD = `# Changelog

## Unreleased

### Added

- First (#1).
  More about it.

### Fixed

- A fix (#2).

## 1.0.0

### Added

- Old (#0).
`

const run = (changelog: string, fragments: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'collated-changelog-'))
  const file = join(root, 'CHANGELOG.md')
  writeFileSync(file, changelog)
  if (Object.keys(fragments).length) {
    mkdirSync(join(root, 'changelog.d'))
    for (const [name, text] of Object.entries(fragments))
      writeFileSync(join(root, 'changelog.d', name), text)
  }
  return spawnSync(process.execPath, [script, '--file', file], { encoding: 'utf8' })
}

describe('changelog check', () => {
  it('passes a good changelog', () => {
    const result = run(GOOD)
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('passes the real CHANGELOG.md', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    ['no Unreleased', GOOD.replace('## Unreleased', '## Next'), 'no "## Unreleased" section'],
    [
      'an unknown heading',
      GOOD.replace('### Fixed', '### New stuff'),
      '"### New stuff" should be one of',
    ],
    ['an empty heading', GOOD.replace('- A fix (#2).\n', ''), '"### Fixed" has no entry'],
    ['an empty heading at the end', `${GOOD}\n### Security\n`, '"### Security" has no entry'],
    [
      'text that is not a list',
      GOOD.replace('- First (#1).', 'First (#1).'),
      '"### Added" has no entry',
    ],
  ])('fails on %s', (_, changelog, message) => {
    const result = run(changelog)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('fails on a leftover fragment, naming it', () => {
    const result = run(GOOD, { '111-thing.md': '### Added\n\n- Thing (#111).\n' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('changelog.d/111-thing.md: move its lines under Unreleased')
  })
})
