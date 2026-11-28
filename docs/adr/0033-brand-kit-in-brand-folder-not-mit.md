---
public: true
---

# 0033: The brand lives in brand/, drawn by code, and isn't MIT

- **Status:** Accepted
- **Date:** 2026-11-28
- **PR:** [#164](https://github.com/mtblck/collated/pull/164)

## Context

Collated's logo was a hand-written 64-unit `public/favicon.svg` in the
colours from before the light table (#26221f, #c8462a), with
`scripts/make-icons.mjs` rendering the app icons from it. It faked the front
page's hole by painting it in the background colour, so it had no honest
one-colour version, and there was no wordmark file, guidelines, palette or
social image. Everything in the repo is MIT, which would let anyone ship a
fork under the Collated name and logo.

## Decision

We keep the stacked-pages mark (Matt's pick) and draw it, the lockups and
the favicon with a script in `brand/draw.mjs`, using the `brand-kit` plugin
from Matt's marketplace, in the app's own tokens. The plugin exports the
whole kit from `brand/brand.json` into `brand/dist/` (ignored, rebuilt on
demand); the site's favicon and app icons are copied from it, and
`scripts/make-icons.mjs` is gone. `brand/` carries its own LICENSE (all
rights reserved) and TRADEMARKS.md; the root README says the brand isn't
under MIT.

## Consequences

Changing the logo means editing `draw.mjs` and re-running the export, which
needs the plugin, Node and network for Google Fonts once. The kit's binaries
stay out of git; the zip is shared from the project instead. Forks keep the
files but need their own name and logo to ship.
