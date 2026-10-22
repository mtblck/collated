# Licences of the C libraries in tesseract.js-core

tesseract.js-core compiles these libraries into its WebAssembly engines
(`ocr/core/*.wasm.js` on the site). They aren't separate npm packages, so
their licence files are vendored here, copied unchanged from each project's
source at the commit tesseract.js-core **7.0.0** builds (its `third_party/`
submodules at tag `v7.0.0`). The npm package's engine files are identical
to those committed at that tag.

| Library   | Upstream commit (nearest tag)            | File here                                   | Upstream file           |
| --------- | ---------------------------------------- | ------------------------------------------- | ----------------------- |
| Leptonica | `4af068b5` (1.82.0-35)                   | `leptonica.txt`                             | `leptonica-license.txt` |
| libtiff   | `b51bb157` (v4.3.0-180)                  | `libtiff.txt`                               | `COPYRIGHT`             |
| libpng    | `a37d4836` (v1.6.37-36)                  | `libpng.txt`                                | `LICENSE`               |
| zlib      | `21767c65` (v1.2.12)                     | `zlib-README.txt` (the notice is in README) | `README`                |
| libjpeg   | `6c0fcb8d` (IJG 8.4.0-4, LuaDist mirror) | `libjpeg-README.txt` (see LEGAL ISSUES)     | `README`                |
| libwebp   | `20ef03ee` (v1.2.2-7)                    | `libwebp.txt`, `libwebp-PATENTS.txt`        | `COPYING`, `PATENTS`    |
| giflib    | `fa376720` (mirrorer mirror)             | `giflib.txt`                                | `COPYING`               |
| OpenLibm  | `ae2d9169` (v0.8.1)                      | `openlibm.txt`                              | `LICENSE.md`            |

Tesseract itself is Apache-2.0, shipped as `licenses/Apache-2.0.txt`.

When upgrading tesseract.js-core, check its `third_party/` submodule commits
and refresh these files; `tests/licenses.test.ts` fails until the version
above matches the installed package.
