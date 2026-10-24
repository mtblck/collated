---
public: true
---

# 0012: A blank page is a page with no pictures, sized by page setup

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** [#97](https://github.com/mtblck/collated/pull/97)

## Context

Printing double-sided often needs a blank back or a separator page (#80).
Every page so far showed at least one picture: `Page.assetId` is required,
and layout, export, thumbnails, sorting and blank detection (#68) all start
from an asset. Options:

- A real asset: a white image (or a one-page PDF) made on insert. Nothing
  else changes, but the file gains an image per blank page, blank detection
  flags it, and "Match image" would size it from a made-up picture.
- A combined page (ADR 0005) with no slots. Free in the walkers, but every
  sheet control (kind, split, "the empty space keeps pictures the same
  size") would have to learn that it isn't one.
- A flag on the page: `Page.blank`, `assetId: ''`, and `picturesOf` returns
  no pictures.

## Decision

We mark an inserted blank page with `Page.blank` and give it no pictures.
`layoutSheet` sizes it from page setup: portrait unless page setup says
landscape or, with Auto, the page is turned (its `turns` are its
orientation). With "Match image" it takes the size of the nearest page with
a picture before it (`sizeModel`), else after it, else Letter. The export
draws nothing on it but the page number.

## Consequences

Code that walks `picturesOf(page)` handles blank pages without change, and
lookups of `assets[page.assetId]` find nothing and skip them. A few places
had to say what a page without pictures means: blank detection (an empty
list is "every picture looks blank"), combining and sorting (blank pages
stay where they are), Apply to all (it would turn them), names and undo
announcements. Anything new that assumes a page has a picture must check
`page.blank`. A blank page can't hold content; to write on one, add a real
page.
