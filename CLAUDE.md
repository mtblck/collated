# Collated

Images → one PDF, client-only, at https://collatedpdf.com/ (own Vercel project and origin, #25; the old mattblack.space/tools/collated/ address redirects there, from both this project and mb-portfolio). Public, MIT. README has the design notes; read them before changing placement or import.

## Commands

`npm run check` (prettier, eslint strict-type-checked, tsc, vitest) · `npm run build` (hosting:check + tsc + vite) ·
`npm run verify` after a build (Chromium E2E + axe + preview≡PDF pixel check). In Claude's sandbox:
`CHROME_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`.

## Load-bearing decisions

- **`layoutPage` is the only placement logic.** Preview (CSS) and export (pdf-lib) both draw from it. pdf.test.ts rasterises with pdftoppm to prove it; don't bypass it.
- **Combined pages** (#76, ADR 0005): `Page.sheet.slots` hold the pictures; `layoutSheet` places each through `layoutPage` in its cell. `page.assetId` is only the first picture: walk content with `picturesOf(page)`.
- **Black-outs remove, never cover** (#77, ADR 0009): `redactions` are rectangles of the upright image (like `corners`). `filterCanvas` paints them on the source before crop/filter; a PDF picture with any is never copied as vectors (`NeedsDrawing`); `wordsClear` drops OCR words under them. Keep all three when touching export.
- **JPEG passthrough + `storedTurns`.** EXIF-rotated JPEGs keep their bytes; the export adds the rotation. Upright dims in `Asset`, stored dims derived.
- **pdf-lib only in the worker.** Never import `core/pdf.ts` from UI code (that's why `core/filename.ts` exists).
- **PDF pages are assets sharing a `bytesId`;** `/Rotate` rides `storedTurns`, export embeds `visibleBox` (crop ∩ media). pdf.js = **legacy build** (modern one needs `Map#getOrInsertComputed`), dynamic-imported; its worker is `.mjs`, so any server must send `text/javascript` for it.
- **HEIC:** native decode first; else `import/heic.worker.ts` runs libheif-js (LGPL, separate chunk — keep THIRD-PARTY-NOTICES accurate).
- **OCR** (tesseract.js) reads the page _as displayed_; `OcrWord` fractions are of the rotated image bounds, so text-layer placement has no rotation term. Runtime files are emitted to `ocr/` by `ocr-assets.ts` (no CDN, `workerBlobURL: false`). Auto-rotate (#70, ADR 0004) is a second worker: legacy core + `osd` data, never the LSTM one.
- **Docs** are `docs/*.md` (shared with Boards), built to static pages by `docs-site.ts`; only files in its `PAGES` list are published. Keep the guide and `docs/privacy.md` true to the code.
- **Bytes outside React state** (`import/assetStore.ts`); undo history holds metadata only.
- **Work kept on the device** (`state/workStore.ts`, #74, ADR 0002): IndexedDB `collated-work` holds the history, bytes once per `bytesId` and thumbnails per asset. Never the password. Start over, Discard and the Keep work switch clear it; nothing saves while the restore offer is pending.
- **Service worker** (#73, ADR 0007): `src/sw/sw.ts`, built alone into classic `/sw.js` by `service-worker.ts` (never import app code that would make it a chunk). Pages network first; shell precached; HEIC/OCR cached on first use (the plugin fails the build if they stop matching). Share target posts to `/share`, answered only by the worker; `lib/incoming.ts` hands shared/opened files to the app; shared ones wait for `ShareConfirm` (any site can post to /share), then kept work is restored before adding them. sw.js is `no-cache` (hosting:check).
- **Paths:** base `/`, outDir `dist`, theme.js by absolute path; `/tools/collated/(.*)` redirects permanently to `https://collatedpdf.com/$1` (absolute: the portfolio proxies that path here). CSP `script-src 'self' 'wasm-unsafe-eval'` (HEIC only), `worker-src 'self'` — never `blob:`; `hosting:check` guards it.
- **Button sizes are a prop**, not class overrides (two padding utilities resolve by stylesheet order; it once squashed icons to 6px).
- `@dnd-kit/*` is 0.x and pinned exactly; check announcements and keyboard reorder in verify after upgrading.

The full reasoning behind these, and every other decision worth keeping, is in
`docs/adr/` (one short record per decision; copy `0000-template.md`). Reversing
one means a new ADR that supersedes it, in the same PR.

**Changelog:** never edit `CHANGELOG.md` in a PR (parallel PRs all conflicted on it). Add a fragment to
`changelog.d/` (`### Added` + `- line for people using Collated (#123).`); it's compiled into
CHANGELOG.md on main after merge. See `changelog.d/README.md` and ADR 0013.

Tickets: GitHub Issues here (shown at mattblack.space/boards/collated). Commit as `mtblck <105079242+mtblck@users.noreply.github.com>`.
