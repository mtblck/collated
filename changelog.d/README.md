# Changelog fragments

Don't edit `CHANGELOG.md` in a pull request. Add one file here instead, named after
the change (`pdf-bookmarks.md`, `93-redaction.md`; any name ending in `.md`), with
the lines that belong under **Unreleased**:

```md
### Added

- Black out text before exporting (#93). The covered text is removed from the PDF, not just hidden.
```

Use the headings from [Keep a Changelog](https://keepachangelog.com/en/1.1.0/):
Added, Changed, Deprecated, Removed, Fixed, Security. One file can hold several.
Write for people using Collated, not for developers.

Because every PR adds its own file, parallel PRs never conflict on the changelog.
When a PR merges, `changelog.yml` runs `node scripts/changelog.mjs` on main, which
moves every fragment into `CHANGELOG.md` and deletes it. `npm run check` validates
fragments with `--check`. A user-facing PR without a fragment still gets a line
made from its title, as before.
