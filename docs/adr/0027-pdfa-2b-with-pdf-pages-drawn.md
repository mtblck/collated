---
public: true
---

# 0027: PDF/A exports are PDF/A-2b, with PDF pages drawn and Arimo embedded

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (#116)

## Context

Courts, governments and records offices ask for PDF/A (#116). It's a family:
PDF/A-1 (2005, PDF 1.4) forbids transparency and object streams, which our
watermark opacity, signature PNGs and compact files use; PDF/A-2 (PDF 1.7)
allows them; PDF/A-3 is PDF/A-2 plus attached files of any kind, which we
never write and some archives refuse. Level **b** (basic) promises the pages
look the same forever; **u** adds Unicode text for every glyph and **a**
tagged structure, which images of paper can't honestly give.

What a plain export lacks for PDF/A-2b, and the options for each:

- **Fonts embedded.** Typed text, the watermark and page numbers use the
  standard Helvetica, which isn't. Embedding a real font means a subset file
  and its own PDF font dictionary. Arimo (OFL) has Helvetica's widths for all
  but seven rare characters (± · ÷ ¯ µ Ÿ ƒ), so the layout, measured with
  Helvetica's metrics, still fits. Cut to Windows-1252 with fontTools it is
  18 KB, with no fontkit in the worker. OCR words may stay in an unembedded
  font in mode 3, but every word goes in the glyphless font (ADR 0025)
  instead, so "every font embedded" holds without exception.
- **Imported PDF pages.** Copied as vectors they bring their own fonts
  (often not embedded), CMYK or calibrated colour, LZW streams, transfer
  functions and more. Checking all of that is a validator's job, and getting
  it wrong silently produces a file that claims PDF/A and isn't.
- **Colour.** One output intent is needed; every colour we write is RGB or
  grey (CMYK JPEGs are converted on import), so sRGB fits. Our own compact
  ICC v2 profile, computed from IEC 61966-2-1, avoids shipping a profile file.
- **Metadata.** XMP with the PDF/A part and level, matching the Info
  dictionary; a file ID; no encryption.

## Decision

We export PDF/A-2b. PDF pages are drawn as pictures (the drawing that hidden
layers already use, about 300 dpi) and OCR reads them like scans when it's
on. Visible text is set in an embedded Arimo subset (`core/pdfa.ts`,
`scripts/make-archive-font.py`); every OCR word goes in the glyphless font.
A password and PDF/A exclude each other: the panel sets the password aside
while PDF/A is on. The tests run veraPDF (`scripts/verapdf.sh`, in CI) on
files with marks, a watermark, page numbers, bookmarks and OCR in Latin and
Cyrillic.

## Consequences

PDF/A files with PDF pages are larger and their text is OCR's, not the
original's. Keeping a PDF page as vectors when it already conforms (checked
in the worker) would fix that, and would be the next step if people export
born-digital PDFs as PDF/A. PDF/A-2u would need real glyphs for OCR text
(ADR 0025's font is blank), so it waits for a reason. Anything new the
export writes (a font, a colour space, an action) must keep veraPDF passing.
