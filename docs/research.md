---
order: 10
---

# PDF tools worth adding

Research from October 2026 into what scan-to-PDF tools (Adobe Scan, Microsoft Lens, Apple Notes, NAPS2, Stirling-PDF, iLovePDF, Smallpdf) offer, and what each would cost to do client-side under Collated's constraints: no server, strict CSP (`script-src 'self'`, WASM allowed via `'wasm-unsafe-eval'` if needed), MIT licence. Package sizes are gzipped, measured from the published builds.

Done: merging PDFs (#9), greyscale and B&W filters (#10). Already in v1: page sizes, orientation (incl. auto per page), margins, fit/fill, rotation, straightening, scale, title metadata, JPEG passthrough, EXIF orientation.

## Ranked by value for cost

| #   | Feature                                         | Value      | Cost                          | How                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------- | ---------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Merge existing PDFs**                         | High       | Low–medium                    | `copyPages` in @cantoo/pdf-lib (already a dependency). Thumbnails need pdf.js: `pdfjs-dist` (Apache-2.0) ≈ 131 KB + a ≈ 375 KB worker, both lazy-loaded and self-hosted.                                                                                       |
| 2   | **Document filter** (greyscale / black & white) | High       | Low                           | Canvas: luminance, then adaptive threshold for B&W. Applies at export, so it's the one case that re-encodes a JPEG. Every phone scanner app has this.                                                                                                          |
| 3   | **Compression / target size**                   | High       | Low                           | Downscale to a chosen DPI and re-encode at a chosen JPEG quality; loop to hit a target size (email limits).                                                                                                                                                    |
| 4   | **Auto paper size** ("match image")             | Medium     | Very low                      | Page sized from image pixels at a stated DPI.                                                                                                                                                                                                                  |
| 5   | **Page numbers**                                | Low–medium | Very low                      | pdf-lib `drawText` with a standard font.                                                                                                                                                                                                                       |
| 6   | **Password protection**                         | Medium     | Very low                      | `PDFDocument.encrypt()` in @cantoo/pdf-lib (AES-256).                                                                                                                                                                                                          |
| 7   | **Split / extract**                             | Medium     | Low                           | Export a selection or ranges as separate files.                                                                                                                                                                                                                |
| 8   | **Perspective correction (4-corner crop)**      | Very high  | Medium (manual) / high (auto) | Manual: drag four corners, warp with canvas/WebGL, no dependency. Auto edge detection needs OpenCV.js (`@techstark/opencv-js` ≈ 3.75 MB) or jscanify (MIT, but wraps OpenCV and loads it from a CDN by default — would have to be bundled). Ship manual first. |
| 9   | **Deskew**                                      | Medium     | Medium                        | Projection-profile angle estimate in a worker; feeds the existing Straighten control.                                                                                                                                                                          |
| 10  | **OCR / searchable PDF**                        | High       | Highest                       | `tesseract.js` (Apache-2.0) ≈ 1 MB core WASM + ≈ 3 MB per language, self-hosted, opt-in download. Needs an invisible text layer written ourselves; tesseract's own PDF output would replace ours.                                                              |

## Input formats

- **HEIC:** only Safari decodes it natively (macOS/iOS 17+); Chrome, Firefox and Edge don't. `heic-to` (LGPL-3.0, active) has a CSP-safe build at ≈ 770 KB — load it only when a HEIC file is dropped, as a separate replaceable chunk. Avoid `heic2any`: abandoned and uses `new Function`, which the CSP blocks.
- **EXIF:** `createImageBitmap` applies orientation by default (`imageOrientation: 'from-image'`), which Collated relies on for thumbnails; the export applies it to passthrough JPEGs itself.

## Avoid

- **MuPDF WASM:** AGPL-3.0 (would bind the whole app) and ≈ 4.7 MB.
- **pdf-lib (original):** no release since 2022; @cantoo/pdf-lib is the maintained fork.
- **jsPDF / PDFKit:** can't import pages from existing PDFs, so merging would need a second library.
