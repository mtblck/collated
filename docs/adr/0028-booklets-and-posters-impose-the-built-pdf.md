---
public: true
---

# 0028: Booklets and posters impose the built pages as XObjects

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** booklet and poster printing (#119)

## Context

People print a document as a booklet (fold and staple) or blow one page up
across several sheets as a poster (#119). Combined pages (#76, ADR
[0005](0005-combined-pages-as-slots.md)) already put several pictures on one
sheet, so we considered three ways:

- New sheet kinds in `Page.sheet`. A booklet's order depends on the whole
  document (page 1 shares a side with the last page), and a poster is one
  page across many sheets, so neither fits a page that holds pictures. Every
  combined page, blank page, mark, page number and watermark would also need
  re-placing through `layoutSheet` for each slot.
- Drawing each finished page as an image and tiling those. Simple, but text
  and PDF pages stop being vector, the text layer goes, and a 3 × 3 poster
  of a photo stores nine crops of it.
- Building the PDF as usual, then turning each built page into a form
  XObject and drawing those onto new sheets.

## Decision

We impose at the end of `buildPdf`, before encryption: `core/imposePdf.ts`
embeds every built page as a form XObject (`embedPage`), removes the pages
and their old content streams, and draws the XObjects where the pure layout
in `core/impose.ts` says (`bookletOrder`, `bookletSheets`, `posterSheets`).
The choice lives with the split in Export options (`SplitOptions.print`) and
reaches the build as `BuildInput.print`, the paper already resolved to a
size; with a split, each part is imposed on its own.

## Consequences

What a booklet or poster shows is exactly what an ordinary export makes,
page numbers, marks, watermark and black-outs included, with no second
placement model. Pages stay vector, the OCR text layer stays searchable,
the password still applies, and a poster's tiles share one copy of the page.
The size limit is checked on the imposed file.

Bookmarks are left out: they would point at pages that no longer exist. The
size estimate doesn't count the small overhead of the sheets. Images
(#117) don't take a print layout. Booklets don't allow for creep (outer pages
of thick booklets sticking out); revisit if people print booklets of more
than a few sheets.
