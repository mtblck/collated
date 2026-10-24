/**
 * Changelog fragments: each PR adds its own small file to changelog.d/ instead of
 * editing CHANGELOG.md, so parallel PRs never touch the same lines (#93–#97 all
 * conflicted on the top of Unreleased). A fragment is a slice of Unreleased:
 *
 *   ### Added
 *
 *   - Something new (#123).
 *
 * `node scripts/changelog.mjs` moves every fragment into CHANGELOG.md's Unreleased
 * section, under its heading, and deletes the fragments. changelog.yml runs it on
 * main after each merge, and the release draft runs it first in case a push failed.
 * `--check` only validates the fragments (part of `npm run check`).
 *
 * Paths can be overridden for the tests: --dir <fragments> --file <changelog>.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Keep a Changelog's sections, in the order they appear under a version. */
const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}
const dir = option('--dir', join(root, 'changelog.d'))
const file = option('--file', join(root, 'CHANGELOG.md'))
const checkOnly = args.includes('--check')

/** Splits a fragment into { section: lines[] }, or throws saying what's wrong. */
const parse = (name, text) => {
  const sections = new Map()
  let current = null
  for (const line of text.split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.*?)\s*$/)
    if (heading) {
      const section = SECTIONS.find((s) => s.toLowerCase() === heading[1].toLowerCase())
      if (!section || !line.startsWith('### ')) {
        throw new Error(
          `${name}: "${line}" should be one of ${SECTIONS.map((s) => `### ${s}`).join(', ')}.`,
        )
      }
      current = section
      if (!sections.has(section)) sections.set(section, [])
    } else if (line.trim() !== '') {
      if (!current) throw new Error(`${name}: start with a heading such as "### Added".`)
      sections.get(current).push(line)
    }
  }
  if (sections.size === 0)
    throw new Error(`${name}: empty; add a "### Added" (or other) heading and a line.`)
  for (const [section, lines] of sections) {
    if (!lines.length) throw new Error(`${name}: "### ${section}" has no entry under it.`)
    if (!/^[-*] /.test(lines[0])) throw new Error(`${name}: entries are list items ("- …").`)
  }
  return sections
}

/** Adds each section's entries to the end of that section under Unreleased. */
const merge = (changelog, fragments) => {
  const lines = changelog.split('\n')
  let start = lines.findIndex((l) => /^## \[?unreleased\]?\s*$/i.test(l))
  if (start === -1) {
    let at = lines.findIndex((l) => /^## /.test(l))
    if (at === -1) at = lines.length
    lines.splice(at, 0, '## Unreleased', '')
    start = at
  }
  for (const sections of fragments) {
    for (const [section, entries] of sections) {
      let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
      if (end === -1) end = lines.length
      const at = (s) =>
        lines.findIndex(
          (l, i) => i > start && i < end && l.trim().toLowerCase() === `### ${s.toLowerCase()}`,
        )
      let h = at(section)
      if (h === -1) {
        // Missing heading: put it before the next section that exists, in Keep a Changelog order.
        const next = SECTIONS.slice(SECTIONS.indexOf(section) + 1)
          .map(at)
          .find((i) => i !== -1)
        let insert = next ?? end
        if (next === undefined)
          while (insert > start + 1 && lines[insert - 1].trim() === '') insert--
        lines.splice(insert, 0, '', `### ${section}`, '')
        h = insert + 1
      }
      let b = lines.findIndex((l, i) => i > h && /^#{2,3} /.test(l))
      if (b === -1) b = lines.length
      const body = lines.slice(h + 1, b)
      while (body.length && body[0].trim() === '') body.shift()
      while (body.length && body[body.length - 1].trim() === '') body.pop()
      body.push(...entries)
      lines.splice(h + 1, b - h - 1, '', ...body, '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

const names = existsSync(dir)
  ? readdirSync(dir)
      .filter((n) => n.endsWith('.md') && n.toLowerCase() !== 'readme.md')
      .sort()
  : []
const problems = []
const fragments = []
for (const name of names) {
  try {
    fragments.push(parse(name, readFileSync(join(dir, name), 'utf8')))
  } catch (error) {
    problems.push(error.message)
  }
}
if (problems.length) {
  console.error(`Changelog fragments in ${dir}:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
  process.exit(1)
}
if (checkOnly) {
  console.log(`${names.length} changelog fragment${names.length === 1 ? '' : 's'} OK.`)
  process.exit(0)
}
if (!names.length) {
  console.log('No changelog fragments to compile.')
  process.exit(0)
}
if (!existsSync(file)) {
  console.error(`${file} not found.`)
  process.exit(1)
}
writeFileSync(file, merge(readFileSync(file, 'utf8'), fragments))
for (const name of names) rmSync(join(dir, name))
console.log(`Compiled ${names.join(', ')} into ${file}.`)
