# Third-party notices

Collated is MIT-licensed. It ships these libraries in its built files. The
licence texts that must travel with them are published with the site under
[`licenses/`](https://collatedpdf.com/licenses/THIRD-PARTY-NOTICES.md)
(emitted by `licenses.ts` from the installed packages):
[LGPL-3.0 and GPL-3.0](https://collatedpdf.com/licenses/LGPL-3.0-and-GPL-3.0.txt),
[Apache-2.0](https://collatedpdf.com/licenses/Apache-2.0.txt),
[idb-keyval's notice](https://collatedpdf.com/licenses/idb-keyval-NOTICE.txt) and
[the OCR worker's bundled notices](https://collatedpdf.com/licenses/tesseract-worker-NOTICES.txt),
and [the C libraries in the OCR engine](https://collatedpdf.com/licenses/tesseract-core/README.md).

| Library                                                                                                                                                                                                                                                                   | Licence                      | Used for                                          | Loaded                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| [React](https://react.dev) (`react`, `react-dom`, `scheduler`)                                                                                                                                                                                                            | MIT                          | UI                                                | Always                                                        |
| [@dnd-kit](https://dndkit.com) (`react`, `dom`, `abstract`, `collision`, `geometry`, `state`)                                                                                                                                                                             | MIT                          | Drag-and-drop reordering                          | Always                                                        |
| [@preact/signals-core](https://github.com/preactjs/signals) (used by @dnd-kit)                                                                                                                                                                                            | MIT                          | Drag-and-drop state                               | Always                                                        |
| [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) ¹                                                                                                                                                                                                             | MIT                          | Building the PDF                                  | On export (worker)                                            |
| [fflate](https://github.com/101arrowz/fflate), [culori](https://culorijs.org), [html-entities](https://github.com/mdevils/html-entities), [node-html-better-parser](https://github.com/Sharcoux/node-html-parser) (pdf-lib dependencies)                                  | MIT                          | Compression, colours and SVG parsing in pdf-lib   | On export (worker)                                            |
| [fflate](https://github.com/101arrowz/fflate) (also used directly)                                                                                                                                                                                                        | MIT                          | Packing a split export's PDFs into one ZIP        | On a split export (worker)                                    |
| [tslib](https://github.com/microsoft/tslib) (pdf-lib dependency)                                                                                                                                                                                                          | 0BSD                         | TypeScript helpers                                | On export (worker)                                            |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`)                                                                                                                                                                                                                | Apache-2.0                   | Reading dropped PDFs and drawing their thumbnails | When a PDF is added                                           |
| [tesseract.js](https://github.com/naptha/tesseract.js)                                                                                                                                                                                                                    | Apache-2.0                   | OCR; finding which way up pages are               | When "Make text searchable" is on, at export; Auto-rotate     |
| [regenerator-runtime](https://github.com/facebook/regenerator) (in tesseract.js and its worker)                                                                                                                                                                           | MIT                          | OCR                                               | With OCR                                                      |
| In the OCR worker (`ocr/worker.min.js`): [idb-keyval](https://github.com/jakearchibald/idb-keyval), [wasm-feature-detect](https://github.com/GoogleChromeLabs/wasm-feature-detect)                                                                                        | Apache-2.0                   | Caching OCR data; picking the engine variant      | With OCR                                                      |
| In the OCR worker: [zlib.js](https://github.com/imaya/zlib.js) (`zlibjs`), [bmp-js](https://github.com/shaozilee/bmp-js), [is-url](https://github.com/segmentio/is-url), [buffer](https://github.com/feross/buffer), [base64-js](https://github.com/beatgammit/base64-js) | MIT                          | Unpacking OCR data; reading images                | With OCR                                                      |
| In the OCR worker: [ieee754](https://github.com/feross/ieee754)                                                                                                                                                                                                           | BSD-3-Clause                 | Reading images                                    | With OCR                                                      |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) ² (`ocr/core/*.wasm.js`)                                                                                                                                                                                 | Apache-2.0                   | The OCR engine (Tesseract in WebAssembly)         | With OCR                                                      |
| [Language data](https://github.com/naptha/tessdata) (`@tesseract.js-data/` `eng`, `dan`, `deu`, `fin`, `fra`, `ita`, `nld`, `nor`, `por`, `spa`, `swe`; 4.0.0 best_int)                                                                                                   | Apache-2.0 data, MIT package | OCR, one language at a time                       | With OCR                                                      |
| [Orientation and script data](https://github.com/naptha/tessdata) (`@tesseract.js-data/osd`, 4.0.0 best_int)                                                                                                                                                              | Apache-2.0 data, MIT package | Auto-rotate pages                                 | With Auto-rotate pages                                        |
| [libheif](https://github.com/strukturag/libheif) and [libde265](https://github.com/strukturag/libde265) via [libheif-js](https://github.com/catdad-experiments/libheif-js)                                                                                                | LGPL-3.0                     | Decoding HEIC photos where the browser can't      | When a HEIC file is added in a browser without native support |

¹ pdf-lib also carries code of its own origin from pdf.js (encryption and
stream decoders, Apache-2.0), PDFKit (SVG paths, MIT), UPNG.js (PNG decoding,
MIT), html2canvas's base64 helper (MIT) and Adobe's standard-font metrics.

² tesseract.js-core compiles, unmodified apart from Tesseract itself, these C
libraries into each engine variant: [Tesseract](https://github.com/tesseract-ocr/tesseract)
(Apache-2.0), [Leptonica](http://www.leptonica.org) (BSD-2-Clause),
[libtiff](https://libtiff.gitlab.io/libtiff/) (libtiff licence, BSD-style),
[libpng](http://www.libpng.org/pub/png/libpng.html) (libpng licence),
[zlib](https://zlib.net) 1.2.12 (zlib licence), the
[Independent JPEG Group's libjpeg](https://ijg.org) (IJG licence),
[libwebp](https://chromium.googlesource.com/webm/libwebp) (BSD-3-Clause, with
Google's patent grant), [giflib](https://giflib.sourceforge.net) (MIT) and
[OpenLibm](https://openlibm.org) (MIT, ISC and BSD-style parts). Their licence
files, copied from each project's source at the commits tesseract.js-core
builds, are in
[`licenses/tesseract-core/`](https://collatedpdf.com/licenses/tesseract-core/README.md),
which lists the version of each. This software is based in part on the work of
the Independent JPEG Group.

## libheif (LGPL-3.0)

libheif and the libde265 HEVC decoder compiled with it are used as an
unmodified, separately loaded component: its JavaScript glue and WebAssembly
binary are emitted as their own files (`assets/libheif-*.js`,
`assets/libheif-*.wasm`) and loaded at runtime by
`src/import/heic.worker.ts`. You can replace them with your own build of
libheif-js by changing the `libheif-js` dependency and rebuilding. The source
for the version used is at
[libheif-js](https://github.com/catdad-experiments/libheif-js),
[libheif](https://github.com/strukturag/libheif) and
[libde265](https://github.com/strukturag/libde265). The LGPL-3.0 text, and the
GPL-3.0 text it incorporates, ship with the site as
`licenses/LGPL-3.0-and-GPL-3.0.txt` (libheif's own licence file).

Typefaces (Geist, Geist Mono) are under the SIL Open Font License 1.1.
