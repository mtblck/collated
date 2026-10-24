---
public: true
---

# 0003: We find the paper with our own detector, not OpenCV

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (this PR)

## Context

Dragging four corners per page is the slow part of cropping phone photos, and
every scanning app finds the paper's edges itself (#69). docs/research.md
rated that "high cost" because the usual route is OpenCV.js
(`@techstark/opencv-js`, ~3.75 MB, or jscanify, which wraps it and loads it
from a CDN). That is about 25 times the rest of the app, would need
`'wasm-unsafe-eval'` for more than HEIC, and has to be bundled, not fetched,
to keep files and requests on our own origin. A sheet of paper on a table is
a narrow problem: one bright-ish quadrilateral with straight sides.

## Decision

We detect the paper with a small detector of our own (`core/paper.ts`:
per-channel Sobel edges, an orientation-restricted Hough transform, and the
largest quad whose four sides are each mostly backed by an edge), run on the
thumbnail in its own worker. It only ever suggests: the crop editor opens on
it, and Auto-crop all pages is one undoable step that leaves existing crops
alone.

## Consequences

About 3 kB gzipped, no dependency, no CSP change, tens of milliseconds a
page. It needs four straight sides inside (or just touching) the frame: a
sheet running well off the photo, a curled or folded page, or paper on a
table of exactly its colour gets no suggestion, and the editor opens on the
whole image as before. A strong shadow along an edge can pull that side
outwards by a percent or two. If people keep correcting suggestions on
photos like these, revisit with a learned edge model or OpenCV loaded on
demand, measured against the fixtures in `tests/fixtures/paper-*.jpg`.
