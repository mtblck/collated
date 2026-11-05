---
public: true
---

# 0020: Signatures are marks on the page, stored as transparent PNG assets

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (#111)

## Context

Signing is the commonest thing people do with an assembled PDF (#111), and
#112 (text, ticks and dates) needs the same "put something on the page" model.
Choices:

- **Where marks live.** On a picture, in the upright image's space (as
  black-outs do, ADR 0009), or on the page. A signature belongs to the paper:
  it must stay on the signature line when the photo under it is turned,
  cropped or refitted, and blank and combined pages (ADR 0005, 0012) have no
  single picture to hang it on.
- **Units.** Points pin a mark exactly but strand it off the page when the
  paper size changes; fractions of the page keep it on the same part of the
  sheet. Width as a share of the page width, with the height from the
  picture's own shape, never distorts it.
- **What a signature is.** Strokes as vectors would print crisply but leave
  typed and photographed signatures out. A trimmed transparent PNG covers all
  three, and pdf-lib, the canvas and CSS all draw one the same way.
- **Its bytes.** Bytes stay out of React state (ADR 0002). Making the PNG an
  ordinary `Asset` reuses the asset store, the kept work and the export's
  byte transfer unchanged.
- **Saved signatures.** Kept in the document's own database, they would go
  with Start over and with Keep work off, which is when people most want
  them back.

## Decision

We store `Page.marks`: each mark's middle as fractions of the page, a
clockwise turn (±30°), and for a signature an `assetId` and a width as a
share of the page width. `markBox` turns one into a `Layout['image']`-shaped
box in points, which the preview (CSS), the export (pdf-lib `placement`) and
the burn-in canvas all draw from. A signature's PNG is an `Asset`
(`signature-<id>`, format `png`); `assetIdsOf(page)` counts it for the kept
work and the export. Saved signatures live in their own IndexedDB database,
`collated-signatures`, newest 12 kept, deleted only from the picker.

## Consequences

- Marks print over pictures and margins, under the watermark and page number;
  a vector PDF page stays vector with the PNG on top.
- Combining or splitting pages drops marks (a place on one page means
  nothing on the new one); duplicating copies them. Reset keeps them.
- A signature is a picture, not a certificate signature; anyone can lift it
  from the PDF. The guide says so.
- #112 adds kinds to the `Mark` union and reuses `MarkEditor`'s placement.
- Revisit if people need vector-crisp drawn signatures at very large sizes:
  strokes could be kept alongside the PNG and drawn as paths.
