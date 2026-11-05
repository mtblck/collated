# Changelog

What changed for people using Collated, newest first. Format:
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Add your line under **Unreleased** in the same PR as any change people using
Collated would notice, under its heading (Added, Changed, Deprecated, Removed,
Fixed or Security), with the issue or PR number. If another PR merged a line
first, keep both when you rebase. The `release` skill moves Unreleased under a
version or date when it ships.

## Unreleased

### Added

- Task pages (#120, #144): JPG to PDF, Merge PDF files, Scan to PDF, Sign a PDF, Compress a PDF and HEIC to PDF each have their own page with a short how-to, linked from the footer. Their button opens Collated ready for the task: Sign a PDF brings the Sign button into view, Compress a PDF sets image quality to Small, and Scan to PDF puts **Scan pages** first.
- Print as a **booklet** or a **poster** (#119), under **Print as** in Export options. A booklet puts two pages on each side of a sheet in the order that folds and staples into the right sequence, padded with blank pages to a multiple of four. A poster enlarges each page across up to 8 × 8 sheets that overlap a little, with cut marks and a label on each sheet. Pick the paper; text stays sharp and searchable.
- Export PDF/A for archiving (#116): tick **PDF/A, for archiving** in the export options for the kind of PDF courts, governments and records offices ask for (PDF/A-2b, checked with veraPDF), with or without searchable text. Pages from PDFs you added become pictures of themselves, and the file can't have a password.
- **Scan pages** on phones and tablets (#118): the camera stays open inside Collated, outlines the page live and takes it by itself once it's steady, already cropped. Turn the page and it takes the next one. Shutter button, **Auto** on or off, a count of pages taken, and the phone's light where the browser allows it. Asks for camera access; **Take photo** stays for one shot without it.
- Searchable text in Polish, Czech, Slovak, Slovenian, Croatian, Hungarian, Romanian, Turkish, Greek, Bulgarian, Russian and Ukrainian (#94). Pick the language under **Make text searchable**; the text can be searched and copied with every letter intact.
- Fill in forms that have no fields (#112): type text, add today's date, or tick and cross boxes anywhere on a page, in black, blue or red. Text is real, selectable text in the PDF. Works by touch on a phone, with the page still in view while the keyboard is up.
- Install Collated as an app (#73). It opens and works with no connection after your first visit, and in Chrome and Edge (and on Android) it shows up in the share sheet, so photos from the gallery or a PDF from an email go into your document once you confirm them, and in "Open with" for PDFs and images on your computer.
- **Enhance** filter (#71): whitens the paper and lifts shadows while keeping colour, for photos of forms with stamps, highlighted pages and receipts with logos. It sits between Greyscale and B&W.
- Select several pages at once (#65): Shift-click for a range, ⌘/Ctrl-click for one more, ⌘A / Ctrl+A for all, or **Select** on a phone. Rotate, straighten, scale, filter, move, duplicate or remove them together, each as one undo step, and drag any of them to move them all.
- Blank pages (#68): pages that look blank (allowing for show-through, punch holes and dust) are marked **Looks blank**, and **Remove N blank pages** above the pages takes them all out in one undoable step. Nothing is removed without asking.
- Crop to the page now finds the paper in a photo and opens with the corners already on it, ready to check and apply. **Auto-crop all pages** crops every photo to its paper in one undoable step, leaving pages you've already cropped alone.
- Two-sided scans: **Interleave fronts and backs** in the More menu puts a pile of fronts and a pile of backs (reversed or not) into page order in one step. Also there: **Reverse page order**, **Sort by file name** and **Sort by date taken**.
- **Auto-rotate pages** in the More menu turns upside-down and sideways pages the right way up by reading their text, in one undoable step, and says which pages it turned. Pages without enough text are left alone. Opt-in: it downloads about 6 MB the first time, from Collated's own site.
- Several pictures on one page (#76): select pages and combine them 2 or 4 per page, or as an **ID card** with both sides at real card size (85.6 × 54 mm). Each picture keeps its rotation, crop and filter; **Split** gives the pages back.
- Export only the selected pages, or split the document into several PDFs by page ranges ("1-3, 4-10") or every few pages (#66). Several files download as one ZIP, each with the same quality, OCR, password and page number options.
- Bookmarks in the exported PDF (#75): name a section at any page (**Section starts here** in the page's settings) and it becomes a bookmark that moves with its page. **Bookmark each imported file** in the export options adds one per file, under its section. Split exports give each file the bookmarks for its own pages.
- Your work survives a reload or a closed tab: the document, undo history included, is kept in this browser on this device (never uploaded, never the password), and Collated offers **Restore your last document?** next time. Start over deletes it, and **Keep work after a reload** in the More menu turns it off.
- **Take photo** on phones and tablets (#72): opens the camera and adds each shot after the last page, without leaving Collated. The system camera takes the picture, so no camera permission is asked for.
- **Black out part of the page** (#77): draw boxes over account or ID numbers, and the export removes what's under them rather than covering it. Pixels are painted over, a PDF page with a box goes in as a picture, and searchable text leaves out words under a box.
- **Watermark** in Export (#78): stamp text such as "Copy for Acme Bank only" across every page or just the selected ones, corner to corner or along the foot, in any size, colour and opacity, shown on the pages as it will print. **Add date** adds today's date. **Burn into image pages** draws it into photo and scan pages so it can't be deleted from the PDF.
- Searchable text in more languages (#79): Danish, Dutch, Finnish, French, German, Italian, Norwegian, Portuguese, Spanish and Swedish as well as English, accents included. Pick **Language of the text** under **Make text searchable**; it starts at your browser's language and is remembered. Each language downloads once (1–4 MB), from Collated's own site.
- **Insert blank page** in the More menu (#80): an empty page after the selected page, or at the end, for a blank back or a separator. It follows page setup (size, orientation, page numbers), can be turned landscape on its own, and is never marked Looks blank.
- A quiet note after a successful export says Collated is free and links to Ko-fi and GitHub Sponsors. It shows at most once a month and never again once you choose Don’t ask again. The repository has a Sponsor button too (#99).
- The Collated name at the top left of the workspace goes back to the home page (#100). Your document is saved first and offered back there; if it can't be kept on this device, Collated asks before leaving.
- Add PDFs that need a password to open, such as bank and payroll statements (#114). Collated asks for the password, unlocks the file in your browser and forgets the password; the pages stay sharp and searchable.
- Add TIFF scans, including multi-page TIFFs from fax machines and office scanners (#113). Each page of the file becomes a page, in order; black-and-white pages stay black and white, so a faxed document stays small, and "Match image" sizes each page to the paper that was scanned.
- Sign a page (#111): draw your signature with a finger, stylus or mouse, type it, or photograph one signed on paper, then place, size and turn it on any page. Signatures can be saved on your device for next time, and are never uploaded.
- Save pages as images (#117): **Save as JPG** or **PNG** in the export options turns each page, or just the selected ones, into an image for upload forms that won't take a PDF. Crops, filters, black-outs, watermarks and page numbers are all in it, at the resolution of the image quality you pick. One page downloads as an image, several as one ZIP; on a phone, Share sends them to your photos or an app.

### Changed

- A new look, the light table: pages lie on a softly lit dark ground (or a pale one in the light theme), the toolbar and the selected page's settings float above them, and the landing page matches. New type (Geist) and an amber accent.
- Collated now counts page views with Vercel Web Analytics: no cookies, and nothing about your pictures or documents. The privacy page says exactly what is recorded (#102).
- Collated now counts how many PDFs are exported, as an anonymous daily total with nothing about you or your files. The privacy notice has the details.
- Page views are now also counted as daily totals on mattblack.space, alongside exports, with no cookies or identifiers; the privacy page says what is kept.
- The home page asks for support with a small Support button in the corner, which steps aside when the footer is in view, instead of a link in the header.
- High, Balanced and Small now shrink the pictures inside PDF pages too, so a heavy scanned PDF gets smaller (#115). Text in PDF pages, including a scanner app's invisible text layer, stays sharp and searchable, and the size estimate counts the savings.

### Fixed

- The header is the same height on the home page, the docs, the task pages and while you work, and the name at its left is the same size and weight on every one: it no longer comes up wider and bolder on some pages while the font loads (#145).
