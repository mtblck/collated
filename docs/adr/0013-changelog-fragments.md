---
public: false
---

# 0013: Changelog entries are fragments in changelog.d/, compiled on main

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** <link once open>

## Context

Each PR wrote its own line at the end of **Unreleased → Added** in
`CHANGELOG.md`. With five PRs open at once (#93, #95, #96, #97 and #91),
every merge left the rest conflicting on the same lines, and each needed a
merge from main just for the changelog. GitHub's merge button ignores
`.gitattributes merge=union`, so that doesn't help. Options:

- **Leave it to `changelog.yml`** (a line from the PR title after merge).
  No conflicts, but titles aren't written for people using Collated, and
  the good lines were what PRs were adding by hand.
- **The line in the PR body**, copied in after merge. No new files, but the
  entry isn't in the diff, so it isn't reviewed or checked by CI.
- **One file per PR** (towncrier, changesets): nothing shared to conflict
  on, the entry is reviewed with the code, and a script can validate it.

## Decision

We write each PR's entry as a fragment in `changelog.d/` (a `### Added`,
`### Fixed`, … heading and list items). `scripts/changelog.mjs` moves every
fragment into Unreleased and deletes it; `changelog.yml` runs it on main
after each merge, and the release draft runs it first in case a push was
refused. `npm run check` validates fragments.

## Consequences

PRs never touch `CHANGELOG.md`, so they only conflict on real code. Between
a merge and the bot's commit the fragment sits in `changelog.d/`, and a
ruleset that blocks the bot's push leaves fragments there until the next
release draft. A PR that still edits `CHANGELOG.md` works as before (the
bot just doesn't add a title line), it just conflicts again.
