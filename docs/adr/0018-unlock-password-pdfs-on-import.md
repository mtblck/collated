---
public: false
---

# 0018: A password-protected PDF is kept as an unlocked copy, never with its password

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** [#132](https://github.com/mtblck/collated/pull/132)

## Context

Bank and payroll statements often arrive with a password to open (#114), and the import refused them. pdf.js asks for the password through `onPassword`, but the opened file is used again later: thumbnails, the page viewer, layered-page drawing, the export (pdf-lib, in the worker) and restored work (IndexedDB, ADR 0002) all read the stored bytes. Options:

1. **Keep the encrypted bytes and the password in memory**, passing it to every reader. Restored work would have to ask again for every locked file, and every new reader of the bytes would have to remember the password.
2. **Draw every page as an image at import.** Simple, but the pages lose their vectors and text, and a statement grows several times in size.
3. **Unlock once, keep an unlocked copy.** `@cantoo/pdf-lib` opens encrypted PDFs (its crypto is pdf.js's), so the export worker can load the file with the password and save it without encryption.

## Decision

We ask for the password in a dialog, open the file with pdf.js, then have the export worker (`core/pdfUnlock.ts`) write an unlocked copy, and store that copy as the PDF's bytes. The password is dropped as soon as the copy exists. If pdf-lib can't open it, each page comes in as a JPEG drawn by pdf.js (option 2) instead of failing. Owner-password-only PDFs already open without asking and are untouched.

## Consequences

Everything downstream sees an ordinary PDF: vectors and text survive, restored work never asks again, and nothing new has to carry a password. The cost is that the copy on this device is unlocked, protected only as well as the browser profile, the same as any other file added; the privacy notice and guide say so. Revisit if people want locked files kept locked at rest (that would mean option 1 and asking again on restore).
