---
public: false
---

# 0019: PRs add their changelog line to CHANGELOG.md, like seedkin and tinkerkit

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** [#133](https://github.com/mtblck/collated/pull/133)

## Context

ADR 0013 moved changelog entries into `changelog.d/` fragments that
`changelog.yml` compiled into `CHANGELOG.md` after each merge. GitHub Actions
isn't available on this repo, so the job never ran: every merge needed a second
hand-made "changelog: add #N" commit on main, and the README and CHANGELOG
described a bot that wasn't there. Matt's other repos, seedkin and tinkerkit,
have each PR write its line under Unreleased directly, and he wants Collated
to match. Options:

- **Keep fragments, compile by hand after merging.** No changelog conflicts,
  but an extra commit to main per PR, and the root changelog is stale
  whenever someone forgets.
- **Edit `CHANGELOG.md` in the PR.** The line is in the reviewed diff and
  the root file is current the moment a PR merges. Parallel PRs can conflict
  on the end of a section (why 0013 happened), but that conflict is always
  "keep both lines", which a rebase settles in a minute.

## Decision

Each PR people using Collated would notice adds its line under **Unreleased**
in `CHANGELOG.md`, under its Keep a Changelog heading. `changelog.d/`,
`changelog.yml` and the compile step are gone; `scripts/changelog.mjs` now only
checks the file (and fails on a leftover fragment) in `npm run check`.

## Consequences

One place, one step, same as seedkin and tinkerkit. A PR that merges after
another one touched the same section needs a rebase. If several threads keep
colliding on every merge, revisit 0013's fragments, with a compile step that
doesn't depend on Actions.
