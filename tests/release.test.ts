// @vitest-environment node
/**
 * scripts/release.mjs (npm run release -- x.y.z): moves [Unreleased] under a dated
 * version, leaves an empty [Unreleased], and keeps the compare links right, for the
 * first release and later ones. Refuses what would make a bad release PR.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: a plain .mjs script with no types
import { cutRelease } from '../scripts/release.mjs'
// @ts-expect-error: a plain .mjs script with no types
import { problems } from '../scripts/changelog.mjs'

const cut = cutRelease as (markdown: string, version: string, date: string) => string
const check = problems as (markdown: string) => string[]
const REPO = 'https://github.com/mtblck/collated'

const FIRST = `# Changelog

Intro.

## [Unreleased]

### Added

- First (#1).

### Fixed

- A fix (#2).
`

describe('cutRelease', () => {
  it('cuts the first release and adds its links', () => {
    const out = cut(FIRST, '1.0.0', '2026-11-16')
    expect(out).toBe(`# Changelog

Intro.

## [Unreleased]

## [1.0.0] - 2026-11-16

### Added

- First (#1).

### Fixed

- A fix (#2).

[Unreleased]: ${REPO}/compare/v1.0.0...HEAD
[1.0.0]: ${REPO}/releases/tag/v1.0.0
`)
    expect(check(out)).toEqual([])
  })

  it('cuts a later release between the last one and the links', () => {
    const first = cut(FIRST, '1.0.0', '2026-11-16')
    const next = first.replace(
      '## [Unreleased]\n',
      '## [Unreleased]\n\n### Fixed\n\n- Later (#3).\n',
    )
    const out = cut(next, '1.0.1', '2026-11-20')
    expect(out).toContain(
      '## [Unreleased]\n\n## [1.0.1] - 2026-11-20\n\n### Fixed\n\n- Later (#3).\n\n## [1.0.0] - 2026-11-16\n',
    )
    expect(out).toContain(
      `[Unreleased]: ${REPO}/compare/v1.0.1...HEAD\n[1.0.1]: ${REPO}/compare/v1.0.0...v1.0.1\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`,
    )
    expect(check(out)).toEqual([])
  })

  it('cuts the real CHANGELOG.md into a valid one', () => {
    const real = readFileSync(join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8')
    expect(check(cut(real, '9.9.9', '2026-11-16'))).toEqual([])
  })

  it.each([
    ['a version that is not semver', FIRST, 'v1.0', "isn't a version like 1.2.0"],
    ['a version already there', cut(FIRST, '1.0.0', '2026-11-16'), '1.0.0', 'already has 1.0.0'],
    [
      'no [Unreleased]',
      FIRST.replace('## [Unreleased]', '## Unreleased'),
      '1.0.0',
      'no "## [Unreleased]"',
    ],
    ['an empty [Unreleased]', cut(FIRST, '1.0.0', '2026-11-16'), '1.0.1', 'nothing to release'],
    [
      'a malformed link',
      `${FIRST}\n[Unreleased]: ${REPO}/commits/main\n`,
      '1.0.0',
      'isn\'t ".../compare',
    ],
  ])('refuses %s', (_, markdown, version, message) => {
    expect(() => cut(markdown, version, '2026-11-16')).toThrow(message)
  })
})
