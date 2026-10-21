# Collated

Images → one PDF, client-only, at https://mattblack.space/tools/collated/ (own Vercel project, proxied by mb-portfolio). Public, MIT. README has the design notes; read them before changing placement or import.

## Commands

`npm run check` (prettier, eslint strict-type-checked, tsc, vitest) · `npm run build` (hosting:check + tsc + vite) ·
`npm run verify` after a build (Chromium E2E + axe + preview≡PDF pixel check). In Claude's sandbox:
`CHROME_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`.

## Load-bearing decisions

- **`layoutPage` is the only placement logic.** Preview (CSS) and export (pdf-lib) both draw from it. pdf.test.ts rasterises with pdftoppm to prove it; don't bypass it.
- **JPEG passthrough + `storedTurns`.** EXIF-rotated JPEGs keep their bytes; the export adds the rotation. Upright dims in `Asset`, stored dims derived.
- **pdf-lib only in the worker.** Never import `core/pdf.ts` from UI code (that's why `core/filename.ts` exists).
- **Bytes outside React state** (`import/assetStore.ts`); undo history holds metadata only.
- **Paths:** base `/tools/collated/`, outDir `dist/tools/collated`, theme.js by absolute path. CSP `script-src 'self'`, `worker-src 'self'`; `hosting:check` guards it.
- **Button sizes are a prop**, not class overrides (two padding utilities resolve by stylesheet order; it once squashed icons to 6px).
- `@dnd-kit/*` is 0.x and pinned exactly; check announcements and keyboard reorder in verify after upgrading.

Tickets: GitHub Issues here (shown at mattblack.space/boards/collated). Commit as `mtblck <105079242+mtblck@users.noreply.github.com>`.
