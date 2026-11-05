---
public: false
---

# 0019: TIFF pages become 1-bit PNGs, embedded as their own compressed data

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** #113's PR

## Context

TIFF (#113) is what scanners, fax machines and copiers save, and no browser but
Safari decodes it (first page only). Fax pages are 1-bit G3/G4: a Letter page is
20–40 KB. Our assets are JPEG, PNG or PDF; pdf-lib's `embedPng` expands every
PNG to 8-bit RGB, so a fax page through the normal path would land in the PDF
at several hundred KB, or as a blurry JPEG. Keeping the G4 bytes and embedding
them with CCITTFaxDecode would be smallest, but no browser can draw them for
thumbnails, filters, crop, OCR or the page viewer, which all decode the stored
bytes. Standard fax resolution is 204 × 98 dpi, so pixels aren't square, and
"Match image" sized every page at one `imageDpi`.

## Decision

UTIF.js (MIT) decodes TIFF in its own worker, one page per TIFF page. 1-bit
pages are stored as 1-bit greyscale PNGs; `embedGreyPng` puts any opaque
non-interlaced grey PNG into the PDF as its IDAT stream with FlateDecode and PNG
predictors, so it stays 1-bit and keeps its size. Other pages are encoded once
as JPEG. Rows or columns are repeated so pixels are square, and the file's
resolution is kept as `Asset.dpi`, which "Match image" uses instead of
`imageDpi`. Pages of one file share `Asset.fileId` (one bookmark, one duplex
pile).

## Consequences

A fax exports at roughly 1.5–2× its G4 size, every existing image path works on
it unchanged, and Match image prints it at the paper size scanned. `embedGreyPng`
passes pdf-lib's `instanceof PngEmbedder` check with an object made from that
prototype: a pdf-lib upgrade must keep the buffer-free `embed()` path (the
1-bit tests in `tiffDecode.test.ts` catch it). UTIF's own `decode()` follows
the IFD chain without end, so we walk it ourselves and call its internal
`_readIFD`; `utif2` is pinned exactly for that reason. Revisit with CCITT
passthrough if fax-heavy exports need to be smaller still.
