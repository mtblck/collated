---
public: true
---

# 0008: Bookmarks come from sections on pages, built where the file names are

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** [#92](https://github.com/mtblck/collated/pull/92)

## Context

Merged PDFs came out with no outline (#75). Collated drops the sources' own
outlines on purpose (`pdfSanitize`: they can point at pages that were
removed and carry text nobody sees), so bookmarks have to be ours. Two kinds
were asked for: one per imported file, and named sections the person
starts at a page. Both must survive reordering, and split exports (#66)
must still make sense.

Options for where a section lives:

- A list of `{ title, pageId }` in `DocState` beside `pages`. Every page
  operation (remove, duplicate, combine, split) would have to keep it in step.
- An index ("section starts at page 4"). Breaks the moment a page moves.
- A field on the page that starts it.

And for where the outline is computed: in the worker from `BuildInput`
(which carries no file names, only what pdf-lib needs), or in the UI.

## Decision

A section is `Page.section`, so it moves, duplicates and undoes with its
page; a copy doesn't start it again, a combined page keeps the first
section among its pictures and splitting gives it back to the first page.
The UI builds each file's outline (`core/outline.ts`, plain data by page id)
and sends it with the export; `core/pdf.ts` writes it in the worker with
pdf-lib's low-level objects (pdf-lib has no outline API) and sets
`/PageMode /UseOutlines`. A file that starts mid-section, such as part 2 of a
split, opens with that section's bookmark. File bookmarks go under their
section, once per section, named after the file without its extension.

## Consequences

Reordering needs no bookkeeping, and the worker never sees file names it
doesn't write. The outline is two levels at most (sections, then files);
nested sections or bookmarks into a page's middle would need a different
model. Section names and bookmarked file names are in the PDF, encrypted
only when it has a password, which the guide and privacy page say.
