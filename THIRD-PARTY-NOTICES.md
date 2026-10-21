# Third-party notices

Collated is MIT-licensed. It ships these libraries in its built files:

| Library                                                                                                             | Licence    | Used for                                          | Loaded                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------- | ------------------------------------------------------------- |
| [React](https://react.dev)                                                                                          | MIT        | UI                                                | Always                                                        |
| [@dnd-kit](https://dndkit.com) (`react`, `dom`)                                                                     | MIT        | Drag-and-drop reordering                          | Always                                                        |
| [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib)                                                         | MIT        | Building the PDF                                  | On export (worker)                                            |
| [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`)                                                          | Apache-2.0 | Reading dropped PDFs and drawing their thumbnails | When a PDF is added                                           |
| [libheif](https://github.com/strukturag/libheif) via [libheif-js](https://github.com/catdad-experiments/libheif-js) | LGPL-3.0   | Decoding HEIC photos where the browser can't      | When a HEIC file is added in a browser without native support |

## libheif (LGPL-3.0)

libheif is used as an unmodified, separately loaded component: its JavaScript
glue and WebAssembly binary are emitted as their own files
(`assets/libheif-*.js`, `assets/libheif-*.wasm`) and loaded at runtime by
`src/import/heic.worker.ts`. You can replace them with your own build of
libheif-js by changing the `libheif-js` dependency and rebuilding. The source
for the version used is at
[libheif-js](https://github.com/catdad-experiments/libheif-js) and
[libheif](https://github.com/strukturag/libheif); its licence text is in
`node_modules/libheif-js/libheif-wasm/LICENSE` after `npm install`.

Typefaces (Instrument Serif, Archivo, JetBrains Mono) are under the SIL Open
Font License 1.1.
