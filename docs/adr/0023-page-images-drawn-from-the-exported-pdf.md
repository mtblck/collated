---
public: true
---

# 0023: Pages saved as images are drawn from the exported PDF

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (#117)

## Context

People need one page as a JPG or PNG for upload forms that won't take a PDF.
The image must show exactly what the PDF would: crop, filters, black-outs,
watermark (as text or burned in), page numbers, combined pages, blank pages
and vector PDF pages. Options considered:

- **Draw each page on a canvas from the document**, like the burned-in
  watermark (ADR 0010). That path doesn't draw page numbers, a text
  watermark or vector PDF pages; each would need a second implementation
  beside the PDF's, and `layoutPage` must stay the only placement logic.
- **Build the PDF as usual, then draw its pages with pdf.js** (already
  loaded for PDF import and the viewer). Whatever the PDF shows, the image
  shows, with nothing new to keep in step. Costs one extra pass over each page.

## Decision

The export builds the PDF from the chosen pages with the usual worker, with
pictures kept as they are (Original), no OCR, password, size limit or
bookmarks, then pdf.js draws each page on the main thread at the quality's
dpi (Original counts as 300), one page at a time, capped at the canvas limit
and freed before the next, and encodes it as JPEG (at the quality's JPEG
setting) or PNG on white. Several images go in one stored ZIP (fflate). On a
touch device that can share files, a dialog asks for the tap the share sheet
needs (the export outlasts the original tap) and shares the images
themselves, not the ZIP.

## Consequences

- Images match the PDF; verify compares a PNG with poppler's drawing.
- Pictures are compressed once, as images, not once in the PDF and again.
- pdf.js renders standard-font text (page numbers, text watermarks) with a
  system font, so the glyphs can differ slightly from a PDF reader's.
- Images of long documents take a second pass; fine for the "one page for a
  form" case this is for.
