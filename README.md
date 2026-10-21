# Collated

Turn a stack of scanned pages or phone photos into one PDF. Drop the images in, drag them into order, rotate, straighten or scale any page, pick a paper size, and export.

**Live:** [mattblack.space/tools/collated](https://mattblack.space/tools/collated/)

Everything happens in the browser. There is no server, no upload, no account and no tracking: the images never leave the device, and the PDF is assembled locally in a Web Worker.

## What it does

- **Import** JPEG, PNG, HEIC (iPhone photos, in every browser), WebP, AVIF, GIF and BMP, and **PDFs**, which come in as one page per PDF page, by drag-and-drop, file picker or paste.
- **Arrange** pages by drag, touch or keyboard (Space to pick up, arrows to move), or with Move earlier/later buttons.
- **Per page:** a **perspective crop** (drag four corners onto the paper in a photo and it's flattened to a rectangle), quarter turns, fine straightening (±45°) with **auto-straighten** for one page or all, scale (10–400%), Fit (whole image) or Fill (fill the page, cropping the overflow), and a filter: Original, Greyscale, or B&W for photographed paper.
- **Document:** US Letter, Legal, Tabloid, A3, A4, A5, a custom size, or _Match image_ (each page sized to its own image at a chosen dpi; PDF pages keep their size); portrait, landscape, or _auto_ (each page turns to match its image); margins; title metadata and filename. Paper and units default to the visitor's locale (Letter/inches in North America, A4/mm elsewhere) and are remembered.
- **Export quality:** Original (images untouched), or High / Balanced / Small, which cap images at 300 / 200 / 150 dpi as printed. An optional size limit steps down until the file fits. The size is estimated before export and reported after.
- **Searchable text (OCR, opt-in):** recognises English text on image pages, on this device, and adds an invisible text layer so the PDF can be searched and copied from.
- **Page numbers** (bottom centre, bottom right or top right, from any start number) and an optional **password** (AES-256) that's held in memory only — never saved.
- **Undo/redo** for everything (⌘Z / ⌘⇧Z, or Ctrl), with a slider drag counted as one step.
- **Print check:** each page shows the resolution it will print at and flags anything under 150 dpi.

## Development

Requires Node 22+.

```sh
npm install
npm run dev            # http://localhost:5173/tools/collated/
npm run check          # prettier --check, eslint, tsc, vitest
npm run build          # hosting:check, tsc, vite build → dist/tools/collated
npm run verify         # real-browser E2E against the build (needs Playwright's Chromium)
```

`npm run verify` serves the build with the production headers from `vercel.json`, drives the app in Chromium (import a mixed batch, keyboard-reorder, rotate, undo, export) and fails on any console error, CSP violation or axe WCAG 2.2 AA violation. Screenshots land in `shots/`. Install a browser once with `npx playwright install chromium`, or point `CHROME_PATH` at an existing Chromium.

Some PDF tests render the output with poppler's `pdftoppm` and are skipped if it isn't installed (`apt install poppler-utils`, `brew install poppler`). CI installs it.

### Layout

```
src/core/      pure, framework-free: model, page sizes, geometry, reducer + undo, image headers, PDF build
src/import/    browser decoding, thumbnails, the out-of-state byte store
src/export/    the export worker and its client
src/state/     React hooks and settings persistence
src/components UI
scripts/       hosting:check, verify
tests/         fixtures (with the script that generates them) and helpers
```

## Design notes

**One geometry function for the preview and the PDF.** `layoutPage` (src/core/geometry.ts) decides the page size and where the image sits: fitted by its _rotated_ bounding box so a straightened scan never pokes outside the printable area, then scaled, then centred. The preview draws that layout with CSS; the export draws the same layout with pdf-lib. Two tests hold them together:

- `src/core/pdf.test.ts` renders exported PDFs with poppler for eight rotation, EXIF, margin and fill cases and checks that each colour quadrant of a test image lands where the layout says. Flipping the sign of the rotation fails four of them.
- `npm run verify` screenshots the on-screen preview and compares it with poppler's render of the same page: 0.61% of pixels differ for a straightened photo and 0.36% for a rotated PDF page. Those pixels lie along the image's edges: the test photo is only 160 px wide, so its preview is an upscaled, slightly soft thumbnail while poppler renders crisply. Misplaced content would differ across whole regions.

**Scans aren't recompressed.** JPEGs go into the PDF byte for byte (the verify script checks the original bytes are in the output). PDF viewers ignore EXIF orientation, so a phone photo stored sideways keeps its bytes and the export adds the EXIF rotation to the page transform instead. Files are only re-encoded (once, at JPEG quality 0.92, on white) when passthrough isn't safe: mirrored EXIF orientations, CMYK JPEGs (which some viewers render as negatives), 16-bit or interlaced PNGs, and formats PDF can't hold (WebP, AVIF, HEIC…). The type comes from the file's bytes, never its extension, and if our header parse disagrees with the browser's decode, the browser wins.

**PDF pages stay vector.** A dropped PDF becomes one asset per page, all sharing the file's bytes. pdf.js renders the thumbnails; the export embeds each page with pdf-lib as a form XObject, so text stays text and nothing is rasterised (verify checks the output holds no image but the JPEG). A page's `/Rotate` goes through the same `storedTurns` path as a JPEG's EXIF orientation, and the export embeds the page's visible box (its crop box clipped to its media box) because that's what pdf.js shows. Raster tests cover rotated, cropped, off-origin and owner-locked PDFs; embedding the media box instead, or ignoring `/Rotate`, fails them. PDFs that need a password to open are refused at import with a message saying so.

**Filters are one function, run twice.** `applyFilter` (src/core/filters.ts) works on raw RGBA, so the same code makes the preview from the thumbnail in the page and the full-size image in the export worker (OffscreenCanvas). B&W is an adaptive threshold (Bradley–Roth over an integral image, window ⅛ of the width): a pixel is ink if it's 15% darker than its neighbourhood. A single global cut turns the shadowed corner of a photographed page black; the unit test runs a lighting gradient that defeats one and checks fewer than 1% of pixels come out wrong. Filtered pages are the one case a JPEG is re-encoded — greyscale as JPEG, B&W as lossless PNG so text edges stay sharp — and the decode applies EXIF orientation, so their stored turns are dropped (a raster test fails if they're applied twice). Verify checks both filters' previews against poppler's render of the export (B&W 0.08%, greyscale 0.71% of pixels differ) and that the B&W page has under 1% mid-tones.

**Compression only ever helps.** Quality presets cap each image's _printed_ resolution (pixels ÷ inches it's drawn at), so a phone photo scaled onto half a page is resized for that half-page, never upscaled. Images are re-encoded as JPEG at the preset's quality, and if the result is bigger than the original — an already-small JPEG — the original goes in instead. A size limit retries the export at each smaller step (down to 96 dpi, as a last resort) and saves the first that fits, or the smallest with a notice saying so; the status line names the resolution used. Measured on a 300 dpi Letter scan: Original 2.48 MB, Small 0.31 MB, and the two render identically at screen size (0.00% of pixels differ). The pre-export estimate came within 1% for that file; it's a model (pixels × a per-quality factor), so the UI marks it ≈.

**Perspective crop is one warp, run twice.** `core/perspective.ts` solves the homography from the output rectangle to the four corners (an 8×8 linear system) and warps raw RGBA by inverse mapping with bilinear sampling — no holes, no dependency, no WebGL. The preview runs it on the thumbnail in the page; the export runs it at full size in the worker, then filters and encodes. Corners are stored as fractions of the upright image, so they're resolution-independent, and every size downstream (layout, match-image pages, printed dpi, compression targets) uses the flattened rectangle via `contentSize`. The rectangle's sides are the mean of the edges they replace: right for paper shot at an ordinary angle, not a true reconstruction of steep foreshortening. Crossed or collapsed corners are refused in the editor and ignored by the reducer. The editor is a native modal `<dialog>`; each corner is a button labelled with its position that moves by arrow key (Shift for 5%). Verify drags the corners onto a photo shot 4° off and gets a page with the paper's exact 3:4 shape (0.751), no table at the edges, and a preview identical to the export (0.00% of pixels differ).

**Auto-straighten reads the lines.** `estimateSkew` binarises the thumbnail with the B&W filter's threshold, then rotates the ink through ±15° (coarse 0.5° steps, then 0.05° around the best) and scores each angle by how uneven the row counts are: level text gives tall peaks for lines and empty gaps between them. Columns are scored too, so a page on its side straightens. A 3% border is ignored (tables and page edges in photos), and if the best angle isn't clearly better than average (< 1.15×) it reports no lines rather than guessing. Synthetic pages from −12° to +7° come back within 0.3°; the 4°-skewed document photo in verify comes back as exactly −4.0°; ~60 ms per page at thumbnail size. "All pages" is one undo step.

**OCR reads what you see, and writes where it was.** tesseract.js runs in its own worker on the page _as displayed_ — cropped, turned, straightened — so a sideways photo you turned upright is read upright, and word boxes come back as fractions of that displayed image. `placeWord` maps them onto the page through the same layout as the pixels, and the builder writes each word as invisible text (rendering mode 3), squeezed horizontally to span the printed word. Words outside Windows-1252 (the standard font's encoding) are skipped rather than written as "?". Everything is self-hosted under `ocr/` by a small Vite plugin, because tesseract.js otherwise fetches from a CDN and starts a `blob:` worker — both refused by the CSP (it runs with `workerBlobURL: false`). First use downloads one engine variant (~1 MB gzipped) and English "best_int" data (2.9 MB). Tests read the layer back with `pdftotext -bbox` for upright, quarter-turned and straightened pages (a flipped mapping fails them) and check the page renders identically with and without it; verify OCRs a sideways printed page in Chromium after turning it, finds every test phrase in the PDF's text, and finds the word "fox" sitting over ink.

**Page numbers are placed once.** `numberMark` returns the text, anchor and baseline; the export draws it with Helvetica and the preview draws it with container-query units (`cqh`) so the type scales with the sheet exactly as points scale with the page. Verify reads the number's position back from the PDF with `pdftotext -bbox` and finds it within 0.08% of the page of where the preview drew it.

**Passwords never persist.** The password lives in component state for the visit — not in settings, localStorage or the undo history — and goes to the worker only with the export. The PDF is AES-256 with a random, discarded owner password and no permission restrictions: it's a lock on opening the file, not DRM. Tests check the file won't open without it, will with it, and that qpdf reports AES-256.

**pdf.js is the legacy build, loaded on demand.** pdf.js 6's modern build calls `Map.prototype.getOrInsertComputed`, which current Chromium releases don't all have yet: every PDF import failed in testing. The legacy build polyfills it for ~19 KB more gzipped, and it loads only when a PDF is dropped (≈150 KB plus its worker).

**pdf-lib only loads to export.** The PDF is built in a module Worker so PNG-heavy batches don't freeze the page. Main bundle: 115 KB gzipped (React and dnd-kit); the worker, carrying pdf-lib: 240 KB gzipped, fetched on first export. A UI import of a helper from the pdf module once pulled pdf-lib into the main bundle (937 KB raw); `filename.ts` lives separately for that reason.

**Image bytes live outside React state.** Undo history holds every version of the document; keeping multi-megabyte images in it would pin them all. State holds metadata, `assetStore` holds bytes, and a removed page's image is kept for the rest of the visit so undo can bring it back (reloading frees it).

**HEIC without loosening the CSP.** Only Safari decodes HEIC natively. The obvious library (heic-to's "CSP build") starts its decoder as a `blob:` worker, which `worker-src 'self'` refuses; allowing `blob:` workers would let any code built in the page run as a worker. Instead libheif-js runs in a worker of our own, its `.wasm` fetched from our origin, so the only addition to the policy is `'wasm-unsafe-eval'` — permission to compile WebAssembly, not to evaluate strings. `hosting:check` now rejects anything else in `script-src` and any `blob:` in `worker-src` (each mutation tried). The decoder (~490 KB gzipped) loads only when a HEIC file is dropped in a browser that needs it; verify imports one in Chromium and finds its page identical to the same image as JPEG.

**Strict CSP.** `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`, no inline scripts (the theme script is a file in `public/` so dark mode applies before first paint), `frame-ancestors 'none'`. `npm run hosting:check` fails the build if any of that, the base path, or the SPA rewrite drifts.

**Library choices** (researched October 2026):

- [`@cantoo/pdf-lib`](https://www.npmjs.com/package/@cantoo/pdf-lib) over `pdf-lib`: the original hasn't released since 2022; this MIT fork is maintained, is a drop-in replacement, and adds encryption. jsPDF and PDFKit can't import pages from existing PDFs, which merging will need.
- [`@dnd-kit/react`](https://dndkit.com) for sorting: keyboard dragging and screen-reader announcements built in (announcements here speak page numbers, not ids). It's 0.x, so it's pinned to an exact version. Move earlier/later buttons mean reordering never depends on dragging.

## Hosting

Built to `dist/tools/collated` with Vite `base: '/tools/collated/'`, so files sit at the same path on the project's own Vercel domain and behind mattblack.space, which proxies `/tools/collated/(.*)` to it. The tool owns its security headers in `vercel.json`.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) © Matt Black. Bundled libraries and their licences — including libheif (LGPL-3.0), loaded as a separate replaceable file — are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
