---
public: true
---

# 0010: A burned-in watermark draws the whole page as one image

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (#78)

## Context

A watermark ("Copy for Acme Bank only") is only a protection if it can't be
taken off. Drawn as PDF text over the page, any editor can delete it and the
untouched photo underneath is still in the file. The ticket asks for an option
to burn it into image pages, and, like page numbers, the preview and the
export must place it identically.

Options considered:

- **Burn it into each picture.** Map the watermark into each image's own
  pixels through the inverse of its placement. The parts of the watermark
  over the margins or a combined page's gaps aren't in any picture, so they'd
  be lost (the preview would need the same clipping), or drawn again as text,
  which doubles the opacity where the two overlap.
- **Draw the whole page on a canvas** with the watermark over it, and embed
  that one image. What prints is exactly what the preview shows; nothing is
  left underneath. Costs a re-encode of every burned page.
- **Rasterise PDF pages too.** Would protect them as well, but turns vector
  text and line art into pixels and loses their own searchable text.

## Decision

With **Burn into image pages** on, a page whose pictures are all pixels
(images, or PDF pages already exported as drawings) is drawn whole on an
OffscreenCanvas in the export worker: white paper, each picture processed as
it would be embedded and placed through the same layout, clipped to its cell,
then the watermark. It goes in as one JPEG at the export's quality, at no less
than each picture's own resolution or 150 dpi, capped by the canvas limit. A
page with a vector PDF page keeps the watermark as text. Placement for both
comes from `watermarkMark`, measured with Helvetica's AFM widths kept in
`core/watermark.ts` and set unkerned everywhere.

## Consequences

- A burned page has no separate photo to recover, and its look matches the
  preview (verify compares both modes against poppler).
- Burned pages lose JPEG passthrough and get bigger; the size estimate
  doesn't model that yet.
- Text beyond WinAnsi (Ł, Cyrillic, CJK) works only when burned in; as text
  the export refuses it with a message rather than printing "?".
- Revisit if people need PDF pages burned in too: drawing them through the
  layered-page path (pdf.js to JPEG) would do it at the cost of their text.
