---
public: true
---

# 0006: Enhance divides out a coarse paper estimate, per channel

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (#71)

## Context

Greyscale removes a cast but also the colour people photograph forms for
(stamps, highlighter, logos); B&W throws away everything but text. Phone
scanners default to a "magic colour" filter that whitens the paper and keeps
ink colour. It has to be `applyFilter` on raw RGBA like the others, so the
thumbnail preview and the full-size export (up to ~12 MP in the worker) agree,
and it must stay fast enough for both.

Options considered:

- **Global levels / auto-white-balance.** One curve for the page can't fix a
  shadow across one corner, which is the usual phone photo.
- **Divide by a large blur of the page** (the ticket's first idea). A mean
  includes the ink, so dense text, a highlighter band or a logo darkens the
  estimate and comes out as a light halo. A large blur at 12 MP is also costly.
- **Integral-image local mean, as B&W uses.** Same ink bias as the blur.
- **OpenCV-style morphological closing.** Right idea (estimate the paper by
  its brightest values), but a dependency or a slow per-pixel max filter.

## Decision

We estimate the paper as a coarse grid, 24 cells across with rows to match,
holding each cell's 90th percentile per channel (a 256-bin histogram per cell,
one pass). Each cell takes its brightest neighbour (so a logo or highlight
filling a cell borrows the paper beside it), the grid gets a 3×3 mean, and
pixels read it by bilinear interpolation between cell centres. Each channel is
divided by its paper value, then one tone curve (black at 6%, white from 90%,
gamma 1.15) whitens the paper and deepens ink. The divisor never drops below
half the page's brightest paper, so a large dark photo stays a photo. Output
is JPEG, like greyscale.

## Consequences

- The grid is in fractions of the image, so the preview and the export agree
  (unit test: a thumbnail and the 4× size differ in under 3% of pixels; verify
  compares the preview with poppler's render of the export).
- Per-channel division neutralises the paper's cast and keeps ink hue; the
  shared curve keeps channel order, so red stays red. Very pale colours get
  lighter, as in other scanner apps.
- Linear time, no dependency: ~120 ms for a 900×1200 photo and ~600 ms for a
  2550×3300 scan in Node.
- A coloured area wider than about two cells (a full-width banner, a photo)
  is partly treated as paper and lightened; the half-brightness floor keeps it
  from going white. The table around an uncropped page is lightened too; the
  guide says to crop first. If that proves common, revisit with a wider
  neighbour search or by masking with the paper detector's quad (ADR 0003).
