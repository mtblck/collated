---
public: true
---

# 0011: OCR reads one Latin-script language at a time, self-hosted, chosen from the browser's language

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (this PR, #79)

## Context

OCR read English only (#79), while paper and units already follow the
visitor's locale, so most visitors outside the US and UK got A4 pages they
couldn't search. Tesseract has "best_int" data for 100+ languages, 0.7–3.8 MB
gzipped each for the Western European ones (`@tesseract.js-data/<code>`).

Constraints and options:

- **Where the data comes from.** The CSP allows only our own origin, so a CDN
  is out (ADR 0004 self-hosts the engine and data for the same reason).
  Self-hosting all eleven languages adds ~25 MB to the deploy, but each
  visitor fetches only the one they pick.
- **Which scripts.** The text layer is written in pdf-lib's standard
  Helvetica, which encodes Windows-1252 only; words outside it are skipped
  (`drawTextLayer` in `core/pdf.ts`). Non-Latin scripts (Greek, Cyrillic,
  Arabic, CJK) would need an embedded, subset font with a ToUnicode map, a
  separate piece of work. Polish, Czech and other Central European languages
  use letters outside 1252 (ł, č, ő) too.
- **One language or several.** Tesseract accepts `fra+eng`, but every page
  then pays for both models (slower, and both downloads).
- **Word confidence.** Tesseract scores whole words against its word list.
  Elisions with a typographic apostrophe, common in printed French and
  Italian, score low even when every letter is certain ("l’élève" 36,
  "all’università" 56, each letter ≥ 92). Our 40 cut-off dropped them.

## Decision

We offer English plus ten languages whose letters are all in Windows-1252
(Danish, Dutch, Finnish, French, German, Italian, Norwegian, Portuguese,
Spanish, Swedish), listed in `core/ocrLanguages.ts`, one at a time. The
choice is `Settings.ocrLanguage`, defaulting from `navigator.language`
(English when it isn't offered) and remembered with the other settings.
`ocr-assets.ts` emits each language's data under `ocr/lang/`; the reader
worker is started for the chosen language and replaced when it changes.
A word below 40 is still kept when every character in it is at 90 or more.

## Consequences

- Adding a 1252 language is one row in `OCR_LANGUAGES` plus its
  `@tesseract.js-data` package; `ocrAssets.test.ts` checks the size shown in
  the picker, `textLayer.test.ts` that its accented letters survive.
- Non-Latin scripts wait for an embedded font (#94).
- Mixed-language pages read best in their main language; a second language
  per document could come later as `fra+eng` if asked for.
- Offline support (#73, ADR 0007) must cache the chosen language's data, not
  only English.
- Work saved before this change restores with English, as it was made.
