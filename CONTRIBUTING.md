# Contributing

Thanks for helping. Collated is small on purpose: it does one job in the browser, with no server and no tracking. Changes that keep it that way are the easiest to accept.

## Before you start

- For anything bigger than a bug fix, open an issue first so we can agree on the approach.
- Files must never leave the device. Features that need a server, a CDN or a third-party script won't be merged.

## Working on it

```sh
npm install
npm run dev
```

Before opening a pull request:

```sh
npm run check     # prettier --check, eslint (strict, type-aware), tsc, vitest
npm run build
npm run verify    # real browser; see README for setup
```

CI runs all of these, plus the poppler-rendered PDF tests.

## Conventions

- **Logic goes in `src/core`** as pure functions with unit tests. Components stay thin.
- **The preview and the PDF share `layoutPage`.** If you change placement, the raster tests in `src/core/pdf.test.ts` and the preview comparison in `scripts/verify.mjs` should still pass; add a case if you add a mode.
- **Accessibility is a requirement**: every control keyboard-operable and labelled, nothing conveyed by colour alone, AA contrast in both themes. `verify` runs axe.
- **Guard rails over comments**: if a config shape has broken once, add a check that fails the build.
- Commit messages: imperative subject line; a body that says why, and how you checked it.
