# Collated

Turn a stack of scanned pages or phone photos into one PDF. Drop the images in, drag them into order, rotate, straighten or scale any page, pick a paper size, and export.

**Live:** [mattblack.space/tools/collated](https://mattblack.space/tools/collated/)

Everything happens in the browser. There is no server, no upload, no account and no tracking: the images never leave the device, and the PDF is assembled locally in a Web Worker.

## What it does

- **Import** JPEG, PNG, WebP, AVIF, GIF and BMP — anything the browser can decode, including HEIC on Safari — and **PDFs**, which come in as one page per PDF page, by drag-and-drop, file picker or paste.
- **Arrange** pages by drag, touch or keyboard (Space to pick up, arrows to move), or with Move earlier/later buttons.
- **Per page:** quarter turns, fine straightening (±45°), scale (10–400%), Fit (whole image) or Fill (fill the page, cropping the overflow), and a filter: Original, Greyscale, or B&W for photographed paper.
- **Document:** US Letter, Legal, Tabloid, A3, A4, A5 or a custom size; portrait, landscape, or _auto_ (each page turns to match its image); margins; title metadata and filename. Paper and units default to the visitor's locale (Letter/inches in North America, A4/mm elsewhere) and are remembered.
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

**pdf.js is the legacy build, loaded on demand.** pdf.js 6's modern build calls `Map.prototype.getOrInsertComputed`, which current Chromium releases don't all have yet: every PDF import failed in testing. The legacy build polyfills it for ~19 KB more gzipped, and it loads only when a PDF is dropped (≈150 KB plus its worker).

**pdf-lib only loads to export.** The PDF is built in a module Worker so PNG-heavy batches don't freeze the page. Main bundle: 115 KB gzipped (React and dnd-kit); the worker, carrying pdf-lib: 240 KB gzipped, fetched on first export. A UI import of a helper from the pdf module once pulled pdf-lib into the main bundle (937 KB raw); `filename.ts` lives separately for that reason.

**Image bytes live outside React state.** Undo history holds every version of the document; keeping multi-megabyte images in it would pin them all. State holds metadata, `assetStore` holds bytes, and a removed page's image is kept until the document is cleared so undo can bring it back.

**Strict CSP.** `script-src 'self'`, `worker-src 'self'`, no inline scripts (the theme script is a file in `public/` so dark mode applies before first paint), `frame-ancestors 'none'`. `npm run hosting:check` fails the build if any of that, the base path, or the SPA rewrite drifts.

**Library choices** (researched October 2026):

- [`@cantoo/pdf-lib`](https://www.npmjs.com/package/@cantoo/pdf-lib) over `pdf-lib`: the original hasn't released since 2022; this MIT fork is maintained, is a drop-in replacement, and adds encryption. jsPDF and PDFKit can't import pages from existing PDFs, which merging will need.
- [`@dnd-kit/react`](https://dndkit.com) for sorting: keyboard dragging and screen-reader announcements built in (announcements here speak page numbers, not ids). It's 0.x, so it's pinned to an exact version. Move earlier/later buttons mean reordering never depends on dragging.

## Hosting

Built to `dist/tools/collated` with Vite `base: '/tools/collated/'`, so files sit at the same path on the project's own Vercel domain and behind mattblack.space, which proxies `/tools/collated/(.*)` to it. The tool owns its security headers in `vercel.json`.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE) © Matt Black. Typefaces (Instrument Serif, Archivo, JetBrains Mono) are under the SIL Open Font License.
