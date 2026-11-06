# Design notes

How Collated works inside, and why it's built the way it is. Read the sections on placement and import before changing either. Each decision has a short record in [`docs/adr/`](docs/adr/); the notes here explain how the pieces fit together.

- [Placement](#placement)
- [Importing](#importing)
- [PDF pages](#pdf-pages)
- [Editing pages](#editing-pages)
- [Searchable text (OCR)](#searchable-text-ocr)
- [Exporting](#exporting)
- [The app shell](#the-app-shell)
- [Security](#security)
- [Library choices](#library-choices)

## Placement

### One geometry function for the preview and the PDF

`layoutPage` (`src/core/geometry.ts`) decides the page size and where the image sits. The image is fitted by its _rotated_ bounding box, so a straightened scan never pokes outside the printable area. Then it's scaled, then centred.

The preview draws that layout with CSS, and the export draws the same layout with pdf-lib. Two tests hold them together:

- **Raster tests.** `src/core/pdf.test.ts` renders exported PDFs with poppler for rotation, EXIF, PDF-page, margin, fill and overflow cases. It checks a grid of points across the printable area against the colour the layout puts there. A gradient fixture (colour = position) checks that an image cropped to its visible part lands exactly where the whole image would; drawing the part at the wrong size or offset fails it.
- **Preview comparison.** `npm run verify` screenshots the on-screen preview and compares it with poppler's render of the same page: 0.61% of pixels differ for a straightened photo and 0.36% for a rotated PDF page. Those pixels lie along the image's edges, because the test photo is only 160 px wide and its preview is a slightly soft, upscaled thumbnail. Misplaced content would differ across whole regions.

### Combined pages go through the same function

A page can hold several pictures (#76): 2 or 4 per page, or both sides of an ID card at 85.6 × 54 mm. Each picture is a slot with its own content, turns, angle, scale, fit, crop and filter.

`layoutSheet` works out the page and one cell per picture. Auto orientation takes whichever way round shows the pictures larger. It then places each picture in its cell with `layoutPage`, so everything above (rotated bounds, Fill, hidden parts left out, OCR placement) applies per picture, clipped to its cell.

The raster tests check 2-up, 4-up and ID card pages the same way as single pages, mixing photos, EXIF-rotated photos and PDF pages. They also check that an ID card comes out at its real size.

### Page numbers are placed once

`numberMark` returns the text, anchor and baseline. The export draws it with Helvetica, and the preview draws it with container-query units (`cqh`), so the type scales with the sheet exactly as points scale with the page.

Verify reads the number's position back from the PDF with `pdftotext -bbox` and finds it within 0.08% of the page of where the preview drew it.

### Watermarks are placed once, too, and can be burned in

`watermarkMark` (#78) gives the text's anchor (the middle of its baseline), size and angle: corner to corner with the capitals centred on the page, or in the bottom band like page numbers.

It sizes the text with Helvetica's own widths, kept in `core/watermark.ts` so the preview needn't load pdf-lib. The PDF, the CSS and the canvas all set it unkerned, because pdf-lib's `widthOfTextAtSize` adds kerning that `drawText` doesn't.

- **As text,** it's `drawText` with an opacity.
- **Burned in,** a page whose pictures are all pixels is drawn whole on a canvas in the export worker, with the watermark over it, and goes in as one JPEG, so there's nothing to delete. Each picture is processed as it would be embedded, at no less than its own resolution or 150 dpi. PDF pages keep the watermark as text.

The preview's text is CSS generated content, so a page card's name still holds all its visible text (WCAG 2.5.3). Verify finds the watermark within 0.14% of the page of where the preview draws it, and both ways the preview matches poppler's render. See [ADR 0010](docs/adr/0010-watermark-burned-in-as-a-page-image.md).

## Importing

### Scans aren't recompressed, and carry nothing but the picture

JPEGs go into the PDF with their coded image data byte for byte (the verify script checks it), minus their metadata. `core/jpegClean.ts` losslessly cuts out EXIF (camera, time, GPS), XMP, IPTC, comments and anything after the image, where phones append previews and depth maps. The ICC profile and Adobe colour marker stay, because decoding needs them.

PDF viewers ignore EXIF orientation. So a phone photo stored sideways keeps its bytes, and the export adds the EXIF rotation to the page transform instead.

Files are only re-encoded (once, at JPEG quality 0.92, on white) when passthrough isn't safe:

- mirrored EXIF orientations
- CMYK JPEGs, which some viewers render as negatives
- 16-bit or interlaced PNGs
- formats PDF can't hold (WebP, AVIF, HEIC, colour TIFF…)

The type comes from the file's bytes, never its extension. If our header parse disagrees with the browser's decode, the browser wins.

### Black-and-white TIFFs stay 1-bit

Fax G3/G4 and most office scans are black-and-white TIFFs. UTIF.js decodes them in `import/tiff.worker.ts` into 1-bit PNGs, which `embedGreyPng` puts in the PDF as their own compressed data, still 1-bit.

A 204 × 98 dpi fax has its rows repeated so its pixels are square. The file's resolution becomes `Asset.dpi` for "Match image" pages.

### HEIC without loosening the CSP

Only Safari decodes HEIC natively. The obvious library (heic-to's "CSP build") starts its decoder as a `blob:` worker, which `worker-src 'self'` refuses. Allowing `blob:` workers would let any code built in the page run as a worker.

Instead, libheif-js runs in a worker of our own, with its `.wasm` fetched from our origin. The only addition to the policy is `'wasm-unsafe-eval'`, which is permission to compile WebAssembly, not to evaluate strings. `hosting:check` rejects anything else in `script-src` and any `blob:` in `worker-src`. The OCR engine (tesseract.js-core) is WebAssembly too, and needs the same permission.

The decoder (~490 KB gzipped) loads only when a HEIC file is dropped in a browser that needs it. Verify imports one in Chromium and finds its page identical to the same image as JPEG.

### Image bytes live outside React state

Undo history holds every version of the document, so keeping multi-megabyte images in it would pin them all. State holds metadata and `assetStore` holds bytes.

A removed page's image is kept for the rest of the visit so undo can bring it back. It goes when the tab closes.

### Password-protected PDFs

A PDF that needs a password to open asks for it in a dialog. The export worker then writes an unlocked copy, which is stored as the PDF's bytes, and the password is dropped. See [ADR 0018](docs/adr/0018-unlock-password-pdfs-on-import.md).

## PDF pages

### PDF pages stay vector

A dropped PDF becomes one asset per page, all sharing the file's bytes. pdf.js renders the thumbnails. The export embeds each page with pdf-lib as a form XObject, so text stays text and nothing is rasterised (verify checks the output holds no image but the JPEG).

A page's `/Rotate` goes through the same `storedTurns` path as a JPEG's EXIF orientation. The export embeds the page's visible box (its crop box clipped to its media box), because that's what pdf.js shows. Raster tests cover rotated, cropped, off-origin and owner-locked PDFs; embedding the media box instead, or ignoring `/Rotate`, fails them.

### Each page is embedded from a minimal copy

Embedding the page as it is would copy its comments, form fields, actions, thumbnails and metadata. Because many scanners share one resource dictionary across pages, it would also copy every other page's images.

So `core/pdfSanitize.ts` makes a minimal copy: the page's content, its boxes, and only the resources its content names. It then walks everything that reaches. Wherever a resource dictionary appears (forms, tiling patterns, Type 3 fonts, soft-mask groups), it prunes it to what that object's own content names. It drops metadata, print alternates and links back into the page tree, and strips JPEG EXIF.

Forms with no resources of their own borrow the page's at any depth, so their names count for the page. An annotation's appearance borrows the form's default resources, else the page's.

An independent reviewer's crafted PDFs export with nothing from other pages and render identically. They cover shared dictionaries reached through each of those routes, `#xx` and NUL-delimited names, and nested forms.

### Annotations are drawn, not carried

What the page shows on top of its content (filled form fields, stamps, signatures, highlights, as pdf.js draws them for the preview) is drawn in from each annotation's own appearance. It's placed on the annotation's rectangle as the spec's appearance algorithm says. The annotations themselves (comment text, form data, actions) stay behind.

Damaged annotations are skipped rather than failing the export. An appearance without resources gets the form's default resources (its fonts).

### Content streams are tokenized, not searched

Content streams (the page's, forms', tiling patterns', Type 3 glyphs') are read by a small tokenizer, `core/pdfContent.ts`. It knows strings, comments and inline images (whose end it finds as pdf.js does), so text that looks like an operator can't fool it. Resource names come from it too, so a name inside a string doesn't keep another page's image.

### Embedded images are cleaned

- Inline JPEGs lose their metadata and anything stored after the image. One wrapped in another filter, or broken, is removed.
- JPEG and JPEG 2000 images inside other filters are unwrapped and stored plain.
- JPEG 2000 files lose their XML, UUID and other metadata boxes.
- An image of either kind that can't be read is dropped.

Only content and images are decoded, once per source file. Fonts and colour profiles are copied untouched, and only once however many pages use them.

The page's content is copied whole, so anything it draws outside the visible box is still in the file, clipped. The import hint says pages are copied as they are.

### A page that hides anything goes as a drawing

If pdf.js's operator list for a page marks anything with a layer its default configuration turns off (content, an image, a form, an annotation), the export doesn't use the vectors. It draws the page with pdf.js exactly as the preview shows it (a ~300 dpi JPEG, `export/layered.ts`) and embeds that instead.

Three rounds of review kept finding ways to carry hidden content through a vector rewrite. The preview is the one definition of "shown" that can't disagree with itself. Other pages' layers are carried with their default visibility.

## Editing pages

### Filters are one function, run twice

`applyFilter` (`src/core/filters.ts`) works on raw RGBA. The same code makes the preview from the thumbnail in the page and the full-size image in the export worker (OffscreenCanvas).

**B&W** is an adaptive threshold (Bradley–Roth over an integral image, with a window ⅛ of the width): a pixel is ink if it's 15% darker than its neighbourhood. A single global cut turns the shadowed corner of a photographed page black. The unit test runs a lighting gradient that defeats one, and checks that fewer than 1% of pixels come out wrong.

**Enhance** divides each colour channel by an estimate of the paper under it, then whitens with a gentle tone curve, so shadows and a warm cast go and ink keeps its hue. The paper estimate is a 24-cell-wide grid of 90th percentiles, each cell taking its brightest neighbour so a logo borrows the paper beside it, then smoothed and read bilinearly. Its unit test lights red and blue strokes on warm paper with a gradient, and checks the paper comes out white everywhere and both ends of each stroke match ([ADR 0006](docs/adr/0006-enhance-divides-out-the-paper.md)).

Filtered pages are the one case a JPEG is re-encoded: greyscale and Enhance as JPEG, B&W as lossless PNG so text edges stay sharp. The decode applies EXIF orientation, so their stored turns are dropped (a raster test fails if they're applied twice).

Verify checks the filters' previews against poppler's render of the export (B&W 0.08%, greyscale 0.71% of pixels differ) and that the B&W page has under 1% mid-tones.

### Perspective crop is one warp, run twice

`core/perspective.ts` solves the homography from the output rectangle to the four corners (an 8×8 linear system). It warps raw RGBA by inverse mapping with bilinear sampling: no holes, no dependency, no WebGL. The preview runs it on the thumbnail in the page; the export runs it at full size in the worker, then filters and encodes.

Corners are stored as fractions of the upright image, so they're resolution-independent. Every size downstream (layout, match-image pages, printed dpi, compression targets) uses the flattened rectangle via `contentSize`.

The rectangle's sides are the mean of the edges they replace. That's right for paper shot at an ordinary angle, but not a true reconstruction of steep foreshortening. Crossed or collapsed corners are refused in the editor and ignored by the reducer.

The editor is a native modal `<dialog>`:

- Each corner is a button with a stable name (its position is in its description) that moves by arrow key (Shift for 5%).
- Dragging has a single-pointer alternative: tap a corner, then tap where it goes.
- Moves are announced in one polite region once the keys settle.

Verify drags the corners onto a photo shot 4° off and gets a page with the paper's exact 3:4 shape (0.751), no table at the edges, and a preview identical to the export (0.00% of pixels differ).

### Finding the paper is ours too, not OpenCV's

`core/paper.ts` works on the thumbnail cut to 320 px:

1. Sobel on each colour channel, so a sheet on a table of similar brightness but another colour still shows, thinned Canny-style.
2. A Hough transform in which each edge pixel votes only within ±3° of its own gradient.
3. Every pair of near-horizontal lines tried with every pair of near-vertical ones.

A side counts by the share of its middle 80% with an edge across it, in either sense, since a shadow can make paper darker than the table along part of a side. The biggest quad whose weakest side is at least 60% supported wins, and each side is refitted to its edge at subpixel precision.

It suggests nothing when no quad passes, when the sheet would cover less than 12% of the photo, or when it already fills the frame. It runs in its own worker (`lib/paper.worker.ts`, ~3 kB gzipped, under `worker-src 'self'` with no CSP change) in 30–130 ms a page.

Fixtures made by `make-fixtures.py` (paper on dark wood, on a light desk with a shadow across it, and turned and foreshortened, with their true corners in `paper-corners.json`) come back within 0.1%, 1.5% and 0.2%. The scan and the full-frame document photo give no suggestion.

The crop editor opens on the suggestion and applies nothing until Apply crop. Auto-crop all pages skips pages already cropped and is one undo step. See [ADR 0003](docs/adr/0003-own-paper-detector.md).

### Auto-straighten reads the lines

`estimateSkew` binarises the thumbnail with the B&W filter's threshold, then rotates the ink through ±15° (coarse 0.5° steps, then 0.05° around the best). It scores each angle by how uneven the row counts are: level text gives tall peaks for lines and empty gaps between them. Columns are scored too, so a page on its side straightens.

A 3% border is ignored (tables and page edges in photos). If the best angle isn't clearly better than average (under 1.15×), it reports no lines rather than guessing.

Synthetic pages from −12° to +7° come back within 0.3°, and the 4°-skewed document photo in verify comes back as exactly −4.0°. It takes ~60 ms per page at thumbnail size. "All pages" is one undo step.

## Searchable text (OCR)

### OCR reads what you see, and writes where it was

tesseract.js runs in its own worker on the page _as displayed_: cropped, turned and straightened. A sideways photo you turned upright is read upright, and word boxes come back as fractions of that displayed image. `placeWord` maps them onto the page through the same layout as the pixels. The builder writes each word as invisible text (rendering mode 3), squeezed horizontally to span the printed word.

Words in Windows-1252 are set in the standard Helvetica. Any other word goes in an embedded glyphless font (`core/glyphless.ts`: one blank glyph, with a ToUnicode map naming each character used). So Polish, Greek or Russian search and copy correctly, while Western European files stay as they were (ADR 0025). Right-to-left and CJK scripts wait for #139.

Words under 40% confidence are dropped as noise, unless every letter in them is at 90% or more, since Tesseract marks down elisions like "l’élève" that it reads perfectly.

### Self-hosted engine and languages

Everything is self-hosted under `ocr/` by a small Vite plugin. Otherwise tesseract.js fetches from a CDN and starts a `blob:` worker, both refused by the CSP (it runs with `workerBlobURL: false`).

First use downloads one engine variant (~1 MB gzipped) and the chosen language's "best_int" data (0.7–3.8 MB). `core/ocrLanguages.ts` lists them (ADR 0011).

**Auto-rotate pages** uses Tesseract's orientation detection, which only the legacy engine has. So it starts a second worker on a legacy variant (~1.8 MB gzipped) with the `osd` data (4.3 MB); see ADR 0004.

### How it's tested

- Tests read the layer back with `pdftotext -bbox` for upright, quarter-turned and straightened pages (a flipped mapping fails them), and check the page renders identically with and without it.
- Verify OCRs a sideways printed page in Chromium after turning it, finds every test phrase in the PDF's text, and finds the word "fox" sitting over ink.

## Exporting

### What a page hides isn't stored

When Fill or a scale past 100% pushes part of an image off the page, the export keeps only the visible part. `visiblePart` (`core/geometry.ts`) maps the printable area into the image as a bounding box, and that image is re-encoded once.

The crop is on whole pixels and copied 1:1 at Original quality, so a PNG stays lossless and a JPEG costs one encode at 0.92. (A fractional crop resampled the whole image and blurred it, which a reviewer measured.) OCR words outside the printable area are dropped too.

The file's metadata is only what you chose: your title (none by default), "Collated" as producer, the date without the time, and `/Lang en`.

### Compression only ever helps

Quality presets cap each image's _printed_ resolution (pixels ÷ inches it's drawn at). A phone photo scaled onto half a page is resized for that half-page, and never upscaled.

Images are re-encoded as JPEG at the preset's quality. If the result is bigger than the original (an already-small JPEG), the original goes in instead.

A size limit retries the export at each smaller step (down to 96 dpi, as a last resort). It saves the first that fits, or the smallest with a notice saying so, and the status line names the resolution used.

Measured on a 300 dpi Letter scan: Original 2.48 MB, Small 0.31 MB, and the two render identically at screen size (0.00% of pixels differ). The pre-export estimate came within 1% for that file. It's a model (pixels × a per-quality factor), so the UI marks it ≈.

### PDF pages shrink their pictures, not their text

With a preset, or a size limit stepping down, each picture a PDF page draws is decoded in the export worker, capped at the preset's dpi for the largest size its page is drawn at, re-encoded as JPEG and swapped in place (`core/pdfImages.ts`, #115). The page's text, fonts, drawings and any invisible OCR layer are copied as before. A picture is kept when the new one isn't smaller.

- Only 8-bit grey or RGB JPEG and Flate pictures are touched (PNG predictors undone in `unfilterPng`).
- 1-bit, JBIG2, CCITT, CMYK, indexed and JPEG 2000 pictures stay as they are.
- A picture's place on its page isn't read, so it's assumed to span the page's long side and is never over-shrunk.

At import, the worker lists each page's shrinkable pictures (`Asset.images`), which the estimate uses. On the heavy scan fixture (2.1 MB: a 300 dpi scan, a Flate photo and a text page), Small makes 0.2 MB with all three pages' text intact. See [ADR 0021](docs/adr/0021-shrink-pictures-inside-pdf-pages.md).

### Passwords never persist

The password lives in component state for the visit, not in settings, localStorage or the undo history. It goes to the worker only with the export.

The PDF is AES-256 with a random, discarded owner password and no permission restrictions: it's a lock on opening the file, not DRM. Tests check the file won't open without it, will with it, and that qpdf reports AES-256.

### pdf-lib only loads to export

The PDF is built in a module Worker, so PNG-heavy batches don't freeze the page. The main bundle is 115 KB gzipped (React and dnd-kit). The worker, carrying pdf-lib, is 240 KB gzipped and fetched on first export.

A UI import of a helper from the pdf module once pulled pdf-lib into the main bundle (937 KB raw). `filename.ts` lives separately for that reason.

### A deploy can't break an open tab's export

The export worker is a hashed file from the build the page came from. It used to load on the first Export, so a tab opened before a deploy asked for a file the new deploy didn't have. The app fallback answered with index.html (under the assets' immutable caching), which a module worker can't run: "The PDF export failed to start".

Now:

- The worker starts as soon as there's a page, and is kept between exports.
- The fallback rewrite covers only extensionless paths, so missing files 404 (`hosting:check` pins it).
- An on-demand chunk that can't load says the app was updated and to reload.

Verify removes the worker's file mid-session and exports anyway.

## The app shell

### One toolbar, and panes that scroll

Page size, orientation, margins and units are set once per document. They live in a Page setup popover whose button shows the current setup ("US Letter · Auto · 0 in margin"). The title moved into Export options with the rest of what describes the file, and rotate-all, the theme and links went into a More menu. That took the header from two rows (about 200 px) to one (56 px).

It's a WAI-ARIA toolbar: one Tab stop, arrow keys and Home/End along it, Alt+T to reach it, and Tab from a popover's button into the popover. Controls inside popovers keep their own arrow keys.

The popovers are anchored to their buttons with CSS anchor positioning where the browser has it, pinned under the header where it doesn't, and shown as a sheet along the bottom on phones.

On a wide screen the window never scrolls. The header stays, and the page grid and the inspector each scroll on their own (the inspector back to its top for each new selection); verify checks the window's scroll stays at 0. Phones keep ordinary page scrolling, with the toolbar on two rows in DOM order so the arrow keys go where the eye does.

### Offline by its own service worker

`src/sw/sw.ts` is built on its own by `service-worker.ts` into one classic `/sw.js`, with the build's file lists written in. The app, pdf.js, the export worker, fonts and docs (3.4 MB) are cached on install, and HEIC and OCR the first time they're used.

Pages load network first, so a deploy still shows up on the next load. The share target's POST is answered by the worker, which keeps the files in a cache until the app opens on them.

Verify installs it in Chromium (no installability errors), then takes the server down and reloads. It imports a PDF and a HEIC photo, exports, opens the docs, and shares two files in through a real form POST. See [ADR 0007](docs/adr/0007-installable-offline-app.md).

### Docs are the repo's markdown, built to static pages

`docs-site.ts` renders the published files in `docs/` (the user guide, privacy notice and terms) to plain HTML at build time with marked: `/docs/…`, `/privacy/` and `/terms/`. `research.md` stays internal. Boards reads the same files, so there's one copy of every doc.

The pages load only the app's stylesheet and `theme.js`, so they sit under the app's CSP unchanged (no framework, no inline script). Verify loads each one under the production headers, runs axe and follows every internal link. A unit test fails if a link between docs doesn't resolve to a published page.

The same file builds the task pages (`/sign-pdf/`, `/merge-pdf/` and four more, from `src/components/tasks.ts`) and `sitemap.xml`: one static page per task people search for, each opening the app with that task ready (ADR 0029).

### pdf.js is the legacy build, loaded on demand

pdf.js 6's modern build calls `Map.prototype.getOrInsertComputed`, which current Chromium releases don't all have yet: every PDF import failed in testing. The legacy build polyfills it for ~19 KB more gzipped. It loads only when a PDF is dropped (≈150 KB plus its worker).

## Security

### Strict CSP

The policy is `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`, `connect-src 'self'` and `frame-ancestors 'none'`, with no inline scripts. The theme script is a file in `public/`, so dark mode applies before first paint.

`npm run hosting:check` fails the build if any of this drifts. It:

- pins every CSP directive to its exact value, and refuses new ones
- requires nosniff, `X-Frame-Options: DENY`, a strict Referrer-Policy, COOP, HSTS and the Permissions-Policy
- checks the base path and the SPA rewrite

`tests/checkHosting.test.ts` applies each loosening to a copy of `vercel.json` and checks the script catches it. Verify also fails if the app makes any cross-origin request, from the page or a worker.

See [HEIC without loosening the CSP](#heic-without-loosening-the-csp) for the one WebAssembly permission.

## Library choices

Researched October 2026.

- **[`@cantoo/pdf-lib`](https://www.npmjs.com/package/@cantoo/pdf-lib) over `pdf-lib`.** The original hasn't released since 2022. This MIT fork is maintained, is a drop-in replacement, and adds encryption. jsPDF and PDFKit can't import pages from existing PDFs, which merging needs.
- **[`@dnd-kit/react`](https://dndkit.com) for sorting.** Keyboard dragging and screen-reader announcements are built in (announcements here speak page numbers, not ids). It's 0.x, so it's pinned to an exact version. Move earlier/later buttons mean reordering never depends on dragging.
