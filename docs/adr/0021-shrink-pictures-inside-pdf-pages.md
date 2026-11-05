---
public: true
---

# 0021: Quality presets shrink the pictures inside PDF pages, in place

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** #115's PR

## Context

Quality presets and the size limit only capped photos. PDF pages went in as
they were, so a 40 MB scanned PDF stayed 40 MB whatever was chosen, while
compressing PDFs is what people most often want from a PDF tool (#115).

The ticket suggested bringing image-only pages in as pictures, so the presets
would apply. That means deciding at import which pages are "just a scan",
redrawing them (a second lossy encode before any preset), and losing what
scanner apps put over the picture: an invisible OCR text layer, which is most
of why a scanned PDF is useful. Pages that mix text and a large photo
wouldn't shrink at all.

## Decision

We shrink the pictures a PDF page draws, in place, in the export worker
(`core/pdfImages.ts`): each image the sanitised page reaches is decoded,
capped at the preset's dpi for the largest size its page is drawn at, and
re-encoded as a JPEG at the preset's quality, then swapped for the original
object. Everything else on the page (text, fonts, vectors, the OCR layer,
annotation appearances) is copied as before. A picture is replaced only if
the result is smaller. Only pictures a browser decodes faithfully are
touched: 8-bit JPEG and Flate images in grey or RGB (device, calibrated or
ICC); 1-bit, JBIG2, CCITT, CMYK, indexed, JPEG 2000, colour-keyed and
`/Decode`d images are kept. At import the worker lists each page's
shrinkable pictures (`Asset.images`) so the size estimate can count them.

Text pages are never rasterised to meet a size limit: a page drawn as a
picture is nearly always larger than its text, and it would lose its text.

## Consequences

Scanned PDFs follow the presets and the size limit like photos, and stay
searchable. Where a picture sits on its page isn't known without reading the
page's drawing, so each is assumed to span its page's long side (its media
box, which can be larger than what shows): the cap never removes more than
the preset would, short of a picture drawn larger than its page and clipped,
but a small picture on a big page may keep more pixels than needed. Black-and-white scans don't shrink (they're
usually small already). Work saved before this has no picture list, so its
estimate counts PDFs whole until they're added again; the export shrinks them
anyway.
