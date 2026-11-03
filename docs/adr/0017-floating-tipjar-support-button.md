---
public: false
---

# 0017: The landing view asks for support with a floating tipjar button

- **Status:** Accepted
- **Date:** 2026-11-03
- **PR:** (this PR)

## Context

ADR 0014 put a plain **Support** link in the landing view's header, next to
Docs and Source, where it read as one more nav item. Matt published
[tipjar](https://github.com/mtblck/tipjar), a small floating tip button (MIT,
no dependencies, about 7 kB gzipped with its stylesheet), and wants Collated
to use it instead.

The constraints from 0014 still hold: nothing third-party loaded, CSP
`script-src 'self'` unchanged, no tracking. tipjar meets them when bundled
from npm: it is our own code shipped in our own bundle, it writes no inline
`<script>`, and it writes an inline `style` only through its `look` option,
which we don't use. A floating button in the workspace would sit over the
notices and the post-export note in the same corner, and over the work.

## Decision

On the landing view only, `TipButton` mounts tipjar in the bottom-right
corner, linking to Ko-fi (`SUPPORT_URL`) in a new tab and tucking itself away
while the footer, with its own **Support Collated** link, is on screen. It
replaces the header's **Support** link. It is themed through the
`--tipjar-*` properties in `index.css` (ink on the table, following
Collated's theme switch). The footer link, the More menu item and the
post-export note (`SupportPrompt`) stay as 0014 describes.

## Consequences

The landing view's Support link is easier to see, at the cost of one fixed
element over the page; it folds to a heart on a phone. tipjar's link is
`rel="noopener"` without `noreferrer` (a deliberate tipjar default), so under
our `strict-origin-when-cross-origin` policy Ko-fi sees that a visitor came
from `https://collatedpdf.com/`, never a path; `docs/privacy.md` says so.
Upgrading tipjar is a normal dependency bump: from 1.0 it follows semver for
its options, markup classes and custom properties. Putting the button in the
workspace or on the docs pages would be a new decision.
