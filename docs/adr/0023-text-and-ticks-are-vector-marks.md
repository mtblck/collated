---
public: true
---

# 0023: Text and ticks are vector marks on the signature layer, sized by the page

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (#112)

## Context

Filling a printed form that has no fields (#112) means typing on it, ticking
its boxes and adding the date. ADR 0020 put signatures on a "marks on the
page" layer and left room for this. Choices:

- **Pictures or vectors.** Rendering text and ticks to PNG would reuse the
  signature path whole, but the text couldn't be selected or searched, and
  a tick would blur when zoomed. pdf-lib's standard Helvetica (already the
  watermark's and the text layer's font) writes real text with no font file
  to ship; a tick is three points of a path.
- **Units for size.** Points read naturally (12 pt), but a form scaled onto a
  different paper size moves under them. A font size as a share of the page
  width keeps the text the same size relative to the form, as the place
  already does (fractions of the page, ADR 0020).
- **Text the font can't write.** Helvetica's encoding is Windows-1252 (#94's
  limit). Embedding a Unicode font would cost hundreds of kilobytes per
  script; refusing other letters in the editor, as the watermark does, is
  honest and cheap.
- **Dates.** A dedicated date kind would need its own format settings. A
  text mark pre-filled with today's date, in the device's medium date style
  (ISO where that style needs other letters), can be corrected like any text.
- **The phone keyboard.** On iOS and Android Chrome the on-screen keyboard
  covers the layout viewport without resizing it, so a full-height dialog's
  bottom, where the typing box is, would be hidden.

## Decision

We add `TextMark` (`text`, `size` as a fraction of the page width, `colour`)
and `StampMark` (`tick` | `cross`, `width`, `colour`) to the `Mark` union.
`vectorMark` lays them out once (each line's baseline in the box, the
stamp's unit-square polylines), and the preview (SVG in the box's own
points), the export (`drawText` per line; stroked paths under one
transformation matrix) and the burn-in canvas all draw from it. The editor
follows `visualViewport` while the keyboard is up, so the page and the text
being typed stay above it.

## Consequences

- Text in the PDF is selectable and searchable; burned-in pages (watermark
  flatten on) draw it into the pixels, so it isn't, there.
- Only Latin letters (Windows-1252) can be typed; the editor names the
  others and holds Apply, and the export refuses them too.
- Empty text is dropped on Apply and by the reducer, like a signature
  without its picture.
- Preview and PDF agree because the preview uses the same Helvetica widths
  (`textWidth`) and baselines; a system without Helvetica or Arial metrics
  could set the preview a little wider or narrower than the PDF.
- Revisit for non-Latin text together with #94 (a subset-embedded font).
