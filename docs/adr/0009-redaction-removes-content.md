---
public: true
---

# 0009: Black-outs remove what's under them: pixels painted first, PDF pages drawn

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** <to fill in>

## Context

People scanning IDs, statements and payslips want to hide a number before
sending the PDF (#77). Most free tools draw a box on top, so the text and
pixels are still in the file. Collated already re-encodes images it changes
and can draw a PDF page as a picture (the hidden-layer path, #52), so it can
remove what's under a box instead. Choices:

- **Where boxes live.** In the flattened page (after the crop), or on the
  upright image, the space `corners` use. On the flattened page a later crop
  would slide a box off the number it covered, silently. On the upright
  image it stays put through any crop, turn or fit; the preview maps it
  through the crop's homography.
- **PDF pages.** Removing text, images and paths under a rectangle from a
  content stream (as a real PDF redactor does) means clipping glyphs, image
  XObjects, shadings and forms, with many edge cases; a miss leaks exactly
  what the person meant to hide. Drawing the page as a picture is already
  how hidden-layer pages go, and is trivially complete.
- **OCR.** A word recognised under a box would put the hidden text back in
  the searchable layer.

## Decision

We store `redactions` on each picture (`Page` and slots) as rectangles of the
upright image. The export paints them black on the source pixels before any
crop, warp, filter or resize, and again over the result so B&W keeps them
solid. A PDF page with a box is never copied as vectors: the worker fails
closed with `NeedsDrawing`, and the page goes as the drawing the hidden-layer
path makes, with the boxes burned in. OCR reads the page with the boxes
painted, and the text layer drops any word touching a box. Reset and Apply
to all leave boxes alone.

## Consequences

- A redacted PDF page loses its selectable text unless OCR is on, and its
  vector sharpness (drawn at the hidden-layer resolution). Every page using
  that PDF page (a duplicate without boxes too) goes as the drawing, since
  drawings are per asset.
- The kept work (#74) still holds the original bytes; boxes are metadata.
  Start over clears it, as before.
- Boxes are edited on single pages; a combined page keeps its pictures'
  boxes (split it to change them).
- Revisit if people need vector output for redacted PDF pages: that means a
  content-stream redactor and tests for each operator kind.
