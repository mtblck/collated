---
public: true
---

# 0004: A combined page holds its pictures as slots, placed by `layoutPage`

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** [#86](https://github.com/mtblck/collated/pull/86)

## Context

People combine several pictures onto one page: both sides of an ID card, or
receipts for an expense claim (#76). Until now each page held exactly one
picture, and everything (layout, export, OCR, thumbnails, kept work) assumed
that. We considered three options:

- Flattening the pictures into a new image when combining. That breaks JPEG
  passthrough and vector PDF pages, and the pictures can't be split back out.
- A separate "sheet" list beside `pages`. Every page operation (order, select,
  undo, export plans) would then need a second kind of item.
- A field on `Page` listing the pictures it shows.

Placement had to stay in `layoutPage`. It is the one function that both the
preview and the export draw from, and the raster tests hold them together.

## Decision

We give `Page` an optional `sheet: { kind, slots }`. Each slot is an
`assetId` plus the whole look a page has (turns, angle, scale, fit, filter,
corners). The page's own `assetId` is its first picture's, and its own look is
unused. `layoutSheet` works out the page size and one cell per slot, then calls
`layoutPage` with that cell. Each picture therefore gets an ordinary `Layout`,
clipped to its cell. Code that walks a page's content uses `picturesOf(page)`,
and per-picture OCR words are keyed by `pictureKey` (`pageId/slot`).

## Consequences

To order, select, move, duplicate, remove and undo, a combined page is just
one page. Splitting it back loses nothing. Placement, hidden-part cropping,
PDF pages and OCR keep their existing tests per picture.

The cost is that any code reading `page.assetId` sees only the first picture.
That was right for sorting and duplex ordering. It was wrong for the group
filter, kept work's reachable assets and Auto-crop all, and all three had to
be fixed. New code that touches a page's content must go through
`picturesOf`.

`sheet` is persisted with kept work ([0002](0002-keep-work-in-indexeddb.md)),
so changing its shape needs a migration or a version bump there. Pictures
can't be edited in place on a combined page: you split, edit and combine
again. Revisit if that becomes a common request.
