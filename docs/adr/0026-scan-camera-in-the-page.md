---
public: true
---

# 0026: The scan camera runs in the page, with our own detector on small frames

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** #141

## Context

Take photo (#72) hands each shot to the system camera: no permission, but one
page per press, a confirm screen each time, and nothing cropped. Scanner apps
are fast on a 20-page stack because the camera stays open, outlines the paper
and shoots when it's steady. Doing that in a browser needs `getUserMedia`, so
camera permission, which Permissions-Policy had switched off (`camera=()`).

Options for finding the paper live: OpenCV.js (~3.75 MB, a WASM chunk and
`wasm-unsafe-eval` for every page that scans), or the detector we already have
(`core/paper.ts`, ADR 0003), which works on a 320 px copy and takes tens of
milliseconds in its worker. For the shot itself: `ImageCapture.takePhoto()`
(full sensor resolution, Chrome only, slow on some phones and it can freeze
the preview) or drawing the current video frame to a canvas.

## Decision

We open the back camera in a full-screen dialog (`components/ScanCamera.tsx`)
asking for about 2560 × 1920, send a 320 px copy of the frame to the existing
paper worker (`paperInFrame` in `lib/paper.ts`) one at a time with a short
pause, and decide when to shoot in pure code (`core/shutter.ts`): the outline
has to hold within 2% of the frame for 0.8 s, and after a shot the page has to
go (the hand turning it) or move by 10% before the next. A shot is the current
frame drawn to a canvas, saved as a JPEG and added through `addFiles` with the
outline as the page's `corners`, so it arrives cropped and Reset undoes it.
Permissions-Policy becomes `camera=(self)`; `hosting:check` requires exactly
that. Take photo stays the default; Scan pages is a second button on touch
devices where `getUserMedia` exists, and any failure offers Take photo.

## Consequences

No new dependency, no new chunk, and the CSP is unchanged (a `MediaStream` in
`srcObject` isn't a fetch, so `media-src` doesn't apply). Frames never leave the
device. A shot is video resolution (often 1920 × 1440 or 2560 × 1440), lower
than the camera app's 12 MP, which is plenty for a page at A4 (about 200 dpi)
but not for small print; `ImageCapture` is the place to look if that matters.
The detector returns nothing when the page fills the frame, so close-ups need
the shutter button. The torch is Chrome on Android only (`torch` capability).
