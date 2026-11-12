---
public: true
---

# 0030: Right-to-left OCR lines go in page order; Chinese and Japanese words are joined

- **Status:** Accepted
- **Date:** 2026-11-12
- **PR:** (#139)

## Context

ADR 0025 let the text layer write any script through the glyphless font, but
two families still read back wrong. Tesseract gives Arabic and Hebrew words in
reading order with their letters in logical order; written left to right like
Latin, pdftotext and pdf.js read each word reversed (`שלום` as `םולש`). Chinese
and Japanese have no spaces between words, but Tesseract splits them where it
sees gaps and the text layer added a space after every word, so `東京都に住む`
copied as `東京都 に 住む` and phrase searches failed.

Options for right-to-left:

- **An `ActualText` span per word.** pdftotext honours it, but pdf.js's text
  extraction (search, copy, the text layer in Firefox) ignores it.
- **Each word reversed, in reading order.** Both readers reverse each word back,
  but pdf.js then takes every word as its own run, drops the space after it
  (the next word is to its left), and copies `שלוםעולם`.
- **The whole line in page order, each word reversed,** the way right-to-left
  PDFs from word processors are written. pdf.js joins the line into one run
  and puts it in reading order with its spaces (its bidi algorithm); pdftotext
  sorts by position and reorders too.

## Decision

`arrangeLine` (core/textLayer.ts) shapes each OCR line before the text layer
writes it. A line with more Arabic-script or Hebrew words than Latin, Greek,
Cyrillic or Korean ones is sorted left to right, given one height (pdf.js also
starts a new run at a change of font size), and marked `rtl`; its words all go
in the glyphless font (and at a change of font) with their characters in page
order (`visualOrder` in core/scripts.ts: letters and their marks reversed, as
the bidi algorithm's rule L2 does; digit and Latin runs kept in order; marks
that end a word left out; brackets not mirrored, as neither reader mirrors
them back). A word on such a line stretches to leave at most half an em before
the next, since pdf.js splits runs at gaps over 0.6 em and would read the
pieces left to right. Combining marks draw a zero-width glyph of the
glyphless font, with `W` saying the same, as in a real font. Close neighbours
that end and start with Chinese characters or kana are joined into one word
(Tesseract's boxes for them overlap, the first often spanning the line).
Korean keeps its spaces. Arabic, Hebrew, Persian, Urdu, Chinese (simplified,
traditional), Japanese and Korean are offered; the browser's locale picks
traditional Chinese for zh-TW and zh-HK.

## Consequences

- `textScripts.test.ts` reads every right-to-left and unspaced language back
  through pdftotext and pdf.js; a new language in one of those scripts must
  have a row there (the test checks).
- A combining mark that ends a right-to-left word (the tanwin in `أهلاً`, a
  point under a final Hebrew letter) would come first on the page with no
  letter before it, and both readers join it to the word on its left instead.
  It's left out: the word copies without it, and pdf.js search ignores marks by
  default anyway. Poppler also places brackets next to a neighbouring number.
- Mixed lines go by their majority: an English line with one Hebrew word stays
  in reading order, and that word is still reversed so it reads back right.
- A right-to-left word's selection box can reach up to the next word when the
  gap is wide (under 3 em; wider gaps are taken as columns).
- Vertical Chinese and Japanese need their own models and a vertical text
  matrix, so they have their own ticket.
- The Chinese and Japanese data list a few legacy-engine settings, and the
  LSTM-only engine warns on the console that it hasn't got them; verify lets
  exactly that warning through.
- Verify step 49 runs real OCR on Hebrew, Arabic and Japanese pages by touch
  on a phone and reads them back with pdftotext and pdf.js.
- Preview and Acrobat weren't checked here; they extract with their own
  bidi handling of the same page-order text that other right-to-left PDFs use.
