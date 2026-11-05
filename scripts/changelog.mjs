/**
 * Checks CHANGELOG.md (part of `npm run check`). PRs add their line under
 * **Unreleased** in CHANGELOG.md itself, like seedkin and tinkerkit (ADR 0022), so
 * this fails on what a PR can get wrong there: no Unreleased section, a heading that
 * isn't one of Keep a Changelog's, an empty heading, or a leftover changelog.d/
 * fragment from before ADR 0022 (move its lines into CHANGELOG.md).
 *
 * The path can be overridden for the tests: --file <changelog>.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const at = args.indexOf('--file')
const file = at === -1 ? join(root, 'CHANGELOG.md') : args[at + 1]

/** Every problem with the changelog text, as messages for people. */
export const problems = (text) => {
  const found = []
  const lines = text.split('\n')
  if (!lines.some((l) => /^## Unreleased\s*$/.test(l)))
    found.push('there is no "## Unreleased" section.')
  lines.forEach((line, i) => {
    const h3 = line.match(/^### (.*?)\s*$/)
    if (!h3) return
    if (!SECTIONS.includes(h3[1]))
      found.push(
        `line ${i + 1}: "${line}" should be one of ${SECTIONS.map((s) => `### ${s}`).join(', ')}.`,
      )
    const next = lines.slice(i + 1).find((l) => l.trim() !== '')
    if (!next || !/^[-*] /.test(next)) found.push(`line ${i + 1}: "${line}" has no entry under it.`)
  })
  return found
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = problems(readFileSync(file, 'utf8')).map((p) => `CHANGELOG.md: ${p}`)
  const leftovers = join(dirname(file), 'changelog.d')
  if (existsSync(leftovers))
    for (const name of readdirSync(leftovers))
      found.push(
        `changelog.d/${name}: move its lines under Unreleased in CHANGELOG.md and delete it (ADR 0022).`,
      )
  if (found.length) {
    for (const p of found) console.error(p)
    process.exit(1)
  }
}
