---
public: true
---

# 0025: Non-Latin OCR text goes in an embedded glyphless font

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (#94)
- **Supersedes:** [0011](0011-ocr-languages-latin-script-one-at-a-time.md)'s limit to Windows-1252 languages (the rest of 0011 stands)

## Context

OCR's invisible text layer was set in pdf-lib's standard Helvetica, which
encodes Windows-1252 only, so ADR 0011 offered only Western European
languages: Polish ł, Czech č, Greek and Cyrillic words were skipped. Writing
other scripts needs an embedded font with a ToUnicode CMap, so search and copy
return the right characters. The text is drawn in rendering mode 3 and never
shows, so the glyphs' shapes don't matter.

Options:

- **Noto Sans subsets.** Real glyphs (useful if a visible text tool ever needs
  them), but one file per script, 100–500 KB each before subsetting, a
  subsetter in the worker (fontkit, ~700 KB), and the OFL notice to carry.
- **Tesseract's `pdf.ttf`.** The glyphless font Tesseract and OCRmyPDF write
  their own PDFs with: Apache-2.0, ~600 bytes, CIDs taken as UTF-16 code
  units, which can't name characters beyond the BMP.
- **Our own glyphless font.** The same idea, built by
  `scripts/make-glyphless-font.py` (fontTools): 756 bytes, two blank glyphs,
  no third-party licence.

Rendering-mode-3 text also matters for PDF/A (#116): every font has to be
embedded there, and a glyphless embedded font is what OCRmyPDF's PDF/A output
uses.

## Decision

We embed our own glyphless TrueType font as a Type 0 font (Identity-H) for any
word Helvetica can't write (`core/glyphless.ts`). Each document numbers the
characters it uses from 1, maps every CID to the blank glyph, and writes a
ToUnicode CMap for just those characters when the pages are done (before
encryption). Words in Windows-1252 stay in Helvetica, so Western European
files don't change; both fonts are created on first use. OCR now offers Polish,
Czech, Slovak, Slovenian, Croatian, Hungarian, Romanian, Turkish, Greek,
Bulgarian, Russian and Ukrainian, and the PDF's `/Lang` is the OCR language's
tag when the text layer has any word.

## Consequences

- Any left-to-right script can be offered by adding its row and data package;
  `textLayer.test.ts` reads each language's letters back with pdftotext.
- Right-to-left scripts read back reversed and CJK needs its own spacing and
  vertical text, so they wait for #139.
- PDF/A (#116) can write every word in this font (one condition in
  `drawTextLayer`) so the text layer has no unembedded font; it may also need
  a CIDSet in the descriptor, which veraPDF will say.
- The glyphs are blank, so this font can't serve visible text (marks, page
  numbers, watermark); a visible non-Latin font would be a separate choice.
- Each language adds 1.3–2.9 MB to the deploy (about 28 MB more in all);
  visitors still fetch only the one they pick.
