# Collated

Images → one PDF, client-only, at https://collatedpdf.com/ (own Vercel project and origin, #25; the old mattblack.space/tools/collated/ address redirects there, from both this project and mb-portfolio). Public, MIT. README has the design notes; read them before changing placement or import.

## Commands

`npm run check` (prettier, eslint strict-type-checked, tsc, vitest) · `npm run build` (hosting:check + tsc + vite) ·
`npm run verify` after a build (Chromium E2E + axe + preview≡PDF pixel check). In Claude's sandbox:
`CHROME_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`.

## Load-bearing decisions

- **`layoutPage` is the only placement logic.** Preview (CSS) and export (pdf-lib) both draw from it. pdf.test.ts rasterises with pdftoppm to prove it; don't bypass it.
- **JPEG passthrough + `storedTurns`.** EXIF-rotated JPEGs keep their bytes; the export adds the rotation. Upright dims in `Asset`, stored dims derived.
- **pdf-lib only in the worker.** Never import `core/pdf.ts` from UI code (that's why `core/filename.ts` exists).
- **PDF pages are assets sharing a `bytesId`;** `/Rotate` rides `storedTurns`, export embeds `visibleBox` (crop ∩ media). pdf.js = **legacy build** (modern one needs `Map#getOrInsertComputed`), dynamic-imported; its worker is `.mjs`, so any server must send `text/javascript` for it.
- **HEIC:** native decode first; else `import/heic.worker.ts` runs libheif-js (LGPL, separate chunk — keep THIRD-PARTY-NOTICES accurate).
- **OCR** (tesseract.js) reads the page _as displayed_; `OcrWord` fractions are of the rotated image bounds, so text-layer placement has no rotation term. Runtime files are emitted to `ocr/` by `ocr-assets.ts` (no CDN, `workerBlobURL: false`).
- **Docs** are `docs/*.md` (shared with Boards), built to static pages by `docs-site.ts`; only files in its `PAGES` list are published. Keep the guide and `docs/privacy.md` true to the code.
- **Bytes outside React state** (`import/assetStore.ts`); undo history holds metadata only.
- **Paths:** base `/`, outDir `dist`, theme.js by absolute path; `/tools/collated/(.*)` redirects permanently to `https://collatedpdf.com/$1` (absolute: the portfolio proxies that path here). CSP `script-src 'self' 'wasm-unsafe-eval'` (HEIC only), `worker-src 'self'` — never `blob:`; `hosting:check` guards it.
- **Button sizes are a prop**, not class overrides (two padding utilities resolve by stylesheet order; it once squashed icons to 6px).
- `@dnd-kit/*` is 0.x and pinned exactly; check announcements and keyboard reorder in verify after upgrading.

The full reasoning behind these, and every other decision worth keeping, is in
`docs/adr/` (one short record per decision; copy `0000-template.md`). Reversing
one means a new ADR that supersedes it, in the same PR.

Tickets: GitHub Issues here (shown at mattblack.space/boards/collated). Commit as `mtblck <105079242+mtblck@users.noreply.github.com>`.
