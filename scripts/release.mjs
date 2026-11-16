/**
 * Prepares a release PR (ADR 0031), like seedkin's: `npm run release -- 1.2.0` moves
 * CHANGELOG.md's [Unreleased] entries under a dated `## [1.2.0] - YYYY-MM-DD` heading,
 * updates the compare links at the foot, and sets `version` in package.json and
 * package-lock.json. Merging that PR to main makes .github/workflows/release.yml run
 * the checks, tag the merge commit v1.2.0 and publish the GitHub release from the
 * changelog. Only a release PR should change `version`.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/mtblck/collated'
const SEMVER = /^\d+\.\d+\.\d+$/
const HEADING = '## [Unreleased]\n'
const UNRELEASED_LINK = /^\[Unreleased\]: .*\/compare\/(v\d+\.\d+\.\d+)\.\.\.HEAD$/m

/**
 * The changelog with its [Unreleased] entries moved under `## [version] - date`, an
 * empty [Unreleased] left above them, and the compare links updated (or, for the
 * first release, added). Throws a message for people when it can't.
 */
export function cutRelease(markdown, version, date) {
  if (!SEMVER.test(version)) throw new Error(`"${version}" isn't a version like 1.2.0.`)
  if (markdown.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md already has ${version}.`)
  const start = markdown.indexOf(HEADING)
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading.')
  const bodyStart = start + HEADING.length
  // The entries end at the next version, or at the link definitions at the foot.
  const rest = markdown.slice(bodyStart)
  const stop = rest.search(/^(## \[|\[[^\]]+\]: )/m)
  const end = stop < 0 ? markdown.length : bodyStart + stop
  const entries = markdown.slice(bodyStart, end).trim()
  if (!/^[-*] /m.test(entries))
    throw new Error('[Unreleased] is empty: there is nothing to release.')
  const section = `${HEADING}\n## [${version}] - ${date}\n\n${entries}\n\n`
  const cut = markdown.slice(0, start) + section + markdown.slice(end)
  const previous = markdown.match(UNRELEASED_LINK)?.[1]
  if (previous)
    return cut.replace(
      UNRELEASED_LINK,
      `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${REPO}/compare/${previous}...v${version}`,
    )
  if (/^\[Unreleased\]: /m.test(markdown))
    throw new Error('CHANGELOG.md\'s "[Unreleased]:" link isn\'t ".../compare/vX.Y.Z...HEAD".')
  // The first release: nothing to compare with yet.
  return `${cut.trimEnd()}\n\n[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${REPO}/releases/tag/v${version}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? ''
  const file = new URL('../CHANGELOG.md', import.meta.url)
  const today = new Date().toISOString().slice(0, 10)
  let markdown
  try {
    markdown = cutRelease(readFileSync(file, 'utf8'), version, today)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
  execFileSync('npm', ['version', version, '--no-git-tag-version'], { stdio: 'inherit' })
  writeFileSync(file, markdown)
  console.log(
    `CHANGELOG.md and package.json are at ${version}. Open the release PR; merging it tags and releases.`,
  )
}
