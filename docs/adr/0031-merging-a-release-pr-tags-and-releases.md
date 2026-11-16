---
public: false
---

# 0031: Merging a release PR tags and releases it, like seedkin

- **Status:** Accepted
- **Date:** 2026-11-16
- **PR:** (this PR)

## Context

Collated had never been tagged or released. A weekly workflow
(`claude-release.yml`, from PR #63) ran Claude with the `release` skill to open
a release PR and a draft GitHub release, and publishing the draft would have
made the tag. The one draft it made (2026-11-02, PR #107) went stale within
days, because nobody published it and the job only drafts once a week; the
2026-11-09 run failed on the org's Claude spend limit. Claude's sessions can't
push tags, so even a ready release needed Matt to publish it by hand. seedkin
releases from a release PR instead (its ADR 0016): merging a version bump on
`main` makes `release.yml` tag and release it with the run's own token. Matt
wants Collated the same, so Claude can run the whole cycle and Matt only says go.

## Decision

`npm run release -- x.y.z` (`scripts/release.mjs`) moves CHANGELOG.md's
`[Unreleased]` entries under `## [x.y.z] - date`, keeps compare links at the
foot, and sets `version`. Claude opens that as the release PR and merges it on
Matt's go. `.github/workflows/release.yml` runs on pushes to `main` that touch
`package.json`: when `version` changed and the changelog has its section, it
runs `npm run check` and the build, tags the merge commit `vx.y.z` with
`GITHUB_TOKEN` and makes the GitHub release from that section. A tag pushed by
hand releases the same way. Versions are semver, starting at 1.0.0. The weekly
Claude draft job is removed. The changelog check now requires `## [Unreleased]`
and `## [x.y.z] - YYYY-MM-DD` headings, which the release reads.

## Consequences

No secret, no Claude run and no spend for a release: the workflow is plain
shell. Any merge that changes `version` releases it, so only a release PR may.
The tag is made after the checks pass, so a red `main` leaves no tag, and a
re-run of a half-finished release finishes it. Nothing here deploys: Vercel
already deploys every merge, so a release names a state that is live. Nobody
is reminded to release any more; Claude suggests one when Unreleased has grown.
If the app-store builds (epic #131) need a version per store build, they read
it from `package.json`.
