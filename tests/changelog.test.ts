// @vitest-environment node
/**
 * scripts/changelog.mjs on a copy: fragments land under the right Unreleased
 * headings and are deleted; bad fragments fail --check, naming the file.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(import.meta.dirname, '..', 'scripts', 'changelog.mjs')

const CHANGELOG = `# Changelog

## Unreleased

### Added

- First (#1).

### Fixed

## 1.0.0

### Added

- Old (#0).
`

const setup = (fragments: Record<string, string>, changelog = CHANGELOG) => {
  const root = mkdtempSync(join(tmpdir(), 'collated-changelog-'))
  const dir = join(root, 'changelog.d')
  mkdirSync(dir)
  writeFileSync(join(dir, 'README.md'), '# Not a fragment\n')
  for (const [name, text] of Object.entries(fragments)) writeFileSync(join(dir, name), text)
  const file = join(root, 'CHANGELOG.md')
  writeFileSync(file, changelog)
  const run = (...extra: string[]) =>
    spawnSync(process.execPath, [script, '--dir', dir, '--file', file, ...extra], {
      encoding: 'utf8',
    })
  return { dir, file, run }
}

describe('changelog fragments', () => {
  it('moves fragments under their headings and deletes them', () => {
    const { dir, file, run } = setup({
      'b.md': '### Added\n\n- Third (#3).\n',
      'a.md': '### Added\n\n- Second (#2).\n  More about it.\n\n### Fixed\n\n- A fix (#2).\n',
    })
    const result = run()
    expect(result.status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(`# Changelog

## Unreleased

### Added

- First (#1).
- Second (#2).
  More about it.
- Third (#3).

### Fixed

- A fix (#2).

## 1.0.0

### Added

- Old (#0).
`)
    expect(existsSync(join(dir, 'a.md'))).toBe(false)
    expect(existsSync(join(dir, 'b.md'))).toBe(false)
    expect(existsSync(join(dir, 'README.md'))).toBe(true)
  })

  it('adds a missing heading in Keep a Changelog order', () => {
    const { file, run } = setup({
      'x.md': '### Changed\n\n- Moved (#4).\n',
      'y.md': '### Security\n\n- Safer (#5).\n',
    })
    expect(run().status).toBe(0)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('- First (#1).\n\n### Changed\n\n- Moved (#4).\n\n### Fixed\n')
    expect(text).toContain('### Fixed\n\n### Security\n\n- Safer (#5).\n\n## 1.0.0')
  })

  it('adds Unreleased when there is none', () => {
    const { file, run } = setup(
      { 'x.md': '### Fixed\n\n- Fixed (#6).\n' },
      '# Changelog\n\n## 1.0.0\n\n- Old.\n',
    )
    expect(run().status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(
      '# Changelog\n\n## Unreleased\n\n### Fixed\n\n- Fixed (#6).\n\n## 1.0.0\n\n- Old.\n',
    )
  })

  it('does nothing without fragments', () => {
    const { file, run } = setup({})
    expect(run().status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(CHANGELOG)
  })

  it.each([
    ['no heading', '- Orphan (#7).\n', 'start with a heading'],
    ['unknown heading', '### New stuff\n\n- Thing.\n', '"### New stuff" should be one of'],
    ['wrong level', '## Added\n\n- Thing.\n', '"## Added" should be one of'],
    ['empty section', '### Added\n', 'has no entry'],
    ['not a list', '### Added\n\nPlain text.\n', 'list items'],
    ['empty file', '\n', 'empty'],
  ])('--check rejects %s, naming the file', (_, fragment, message) => {
    const { file, run } = setup({ 'bad.md': fragment })
    const result = run('--check')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('bad.md: ')
    expect(result.stderr).toContain(message)
    expect(readFileSync(file, 'utf8')).toBe(CHANGELOG)
  })

  it('--check passes good fragments without touching anything', () => {
    const { dir, file, run } = setup({ 'ok.md': '### Added\n\n- Fine (#8).\n' })
    expect(run('--check').status).toBe(0)
    expect(existsSync(join(dir, 'ok.md'))).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe(CHANGELOG)
  })
})
