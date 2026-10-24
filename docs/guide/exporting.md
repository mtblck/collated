---
public: true
order: 5
---

# Exporting

**Export** in the toolbar (it says how many pages, or files, it will make) opens the export options: everything below. At the foot, always in view, are the estimated file size and **Export PDF**, which builds the file and saves it to your downloads. When a password is set, it says **Export locked PDF**. While a file is being built, the toolbar button shows its progress.

## Title and filename

The title is stored in the PDF (readers show it in their title bar) and names the file. Leave it empty for a dated name.

## Pages

- **All pages:** one PDF of the whole document.
- **Selected pages:** one PDF of just the pages you've selected (see [Arranging pages](arranging-pages.md)), in document order.
- **Split by page ranges:** one PDF per range. Type them like `1-3, 4-10, 11-`: `11-` runs to the last page and `-3` starts at the first. Ranges can overlap and come in any order; each file follows the order you wrote. A single range, such as `3-5`, gives just those pages as one PDF.
- **Split every few pages:** a new file every N pages, the last one holding what's left.

Under the choices, a line says what you'll get, or what's wrong with the ranges. Several files download together as one ZIP, named from the title (`Bills.zip`, holding `Bills-part-1.pdf`, `Bills-part-2.pdf` and so on). Every file gets the same options: quality, size limit (each file on its own), searchable text, page numbers, watermark and password. With page numbers on, **In each file** chooses whether each file starts again from the first number or carries on from the file before.

## Image quality

- **Original:** images go in as they are, with no recompression. JPEG photos keep their exact image data. A page is re-encoded once only when it must be: a filter, a crop, a blacked-out area, or Fill / a scale above 100% hiding part of the image (so the hidden part isn't stored).
- **High, Balanced, Small:** cap each image at 300, 200 or 150 dpi as printed, and compress it. Small is for email and uploads.

**Keep the file under** is optional: give a size in MB and Collated tries lower quality, step by step, until the file fits. If it can't, it says so and saves the smallest it made.

## Searchable text (OCR)

**Make text searchable** recognises English text on image pages, and on PDF pages that go into the file as an image (ones with a hidden layer), and adds it to the PDF invisibly, under the picture, so you can search the PDF and copy from it. It reads each page as you see it, crop and rotation included. Recognition runs on your device. The first time, it downloads about 4 MB of recognition data (from Collated's own site, not a third party); after that, it takes a few seconds per page. Anyone with the file can search and copy the text, and the recognised text may contain mistakes.

## Page numbers

Adds a number to every page: bottom centre, bottom right or top right, starting from any number.

## Bookmarks

PDF readers list bookmarks in a side panel, to jump around a long file. To start a section, select its first page and type a name under **Section starts here** in the page's settings; the page shows a bookmark tag with the name. A section belongs to its page, so it moves when you move the page, and undo takes it back like any other change. Clear the name to remove it.

**Bookmark each imported file** adds a bookmark named after each file you added (without its extension), at the first page that shows it. With sections, the files are listed under the section they're in. When you export several files, or only some pages, each file starts with the bookmark of the section its first page is in, so nothing loses its heading. The file names you bookmark are visible to anyone with the PDF, unless it has a password.

## Watermark

Stamps text across your pages, such as "Copy for Acme Bank only", so a copy of an ID or a bill can't be reused for something else. **Add date** puts today's date after the text, so the copy also says when you sent it.

- **Position:** **Across the page** runs it corner to corner through the middle; **Along the foot** puts it in the bottom margin (above the page numbers, if they're there too). Text too long for the page is made smaller to fit.
- **Size, Colour, Opacity:** how large, in what colour and how solid it is. The pages show it as it will print.
- **On:** every page, or only the pages you had selected when you chose **Selected pages**. If you select other pages later, **Use the N selected** moves it to those.
- **Burn into image pages:** normally the watermark is text laid over the page, which a PDF editor could delete. With this on, each page made from photos or scans is saved as one picture with the watermark drawn into it, so there's no clean copy underneath. Those pages are re-encoded (at your image quality, at least 150 dpi), so the file can be larger. Pages from a PDF keep the watermark as text, so their own text stays sharp and searchable.

The PDF's built-in font covers Latin letters, including accents (é, ß, å). Other letters, such as Ł or Cyrillic, can only be burned into image pages; Collated says so under the text.

Like the title, the watermark's text and the pages it's on aren't remembered for next time; how it looks is.

## Password

**Password to open** encrypts the PDF (AES-256); it opens only with the password. Once open, nothing is restricted. Not hidden: the file's name, which comes from the title, and how many pages it has. The password isn't saved anywhere: if you lose it, the file can't be opened. **Show** reveals what you've typed. Passwords can be up to 127 bytes (roughly 60–120 characters, depending on the alphabet).
