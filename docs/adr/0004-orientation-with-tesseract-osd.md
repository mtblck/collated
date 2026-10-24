---
public: true
---

# 0004: We find which way up a page is with Tesseract's OSD, in its own worker

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (this PR)

## Context

A batch fed into a scanner the wrong way, or shot from across the table,
comes in upside-down (#70). Auto-straighten levels lines within ±15° and
sees sideways text, but line profiles look the same at 0° and 180°: telling
them apart means knowing what letters look like. Options:

- **A heuristic of our own** (ascenders vs descenders, where the ragged edge
  of a paragraph falls). Cheap, but unreliable on short or centred text, and
  it can't tell 90° from 270° any better.
- **Run full OCR four times** and keep the orientation with the most
  confident words. Uses the engine we already ship, but ~4× a page's OCR time
  (several seconds a page).
- **Tesseract's orientation and script detection (OSD).** Built for this, a
  fraction of a second a page, and tesseract.js already exposes it as
  `detect()`. But it runs only on the legacy engine: our LSTM-only core can't
  load it, and it needs `osd.traineddata`.

Measured on the fixtures: a full page of text scores 25–35 confidence, four
short lines about 7; pictures and blank pages give no answer at all. Shrunk
to thumbnail size (letters ~12 px) a page scores ~3 and is often wrong.

## Decision

We use OSD in a second tesseract.js worker, started only when someone picks
**Auto-rotate pages**: the legacy core variant (picked by SIMD support, as for
OCR) and `@tesseract.js-data/osd` 4.0.0_best_int, both self-hosted under
`ocr/` by `ocr-assets.ts`. Each page is read as displayed, at up to 2000 px,
and turned only when the answer's confidence is at least 5; the turns are
one undo step and the status names the pages turned.

## Consequences

No CSP change and nothing from a CDN; searchable text keeps its smaller
LSTM-only worker. The first use downloads about 6 MB (1.8 MB core gzipped,
4.3 MB data) and caches the data in IndexedDB; the deploy grows by three
legacy core files (~4.7 MB each, one fetched per visitor) and the data.
Pages with little text, or text in a script OSD doesn't know, are left
alone rather than guessed. If we ever move OCR to the legacy engine too, the
two workers could become one; if the 5-point threshold turns pages wrongly in
practice, raise it, measured against `tests/fixtures/text-letter-*.png`.
