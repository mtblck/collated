---
public: true
order: 5
---

# Exporting

**Export** in the toolbar (it says how many pages there are) opens the export options: everything below. At the foot, always in view, are the estimated file size and **Export PDF**, which builds the file and saves it to your downloads. When a password is set, it says **Export locked PDF**. While a file is being built, the toolbar button shows its progress.

## Title and filename

The title is stored in the PDF (readers show it in their title bar) and names the file. Leave it empty for a dated name.

## Image quality

- **Original:** images go in as they are, with no recompression. JPEG photos keep their exact image data. A page is re-encoded once only when it must be: a filter, a crop, or Fill / a scale above 100% hiding part of the image (so the hidden part isn't stored).
- **High, Balanced, Small:** cap each image at 300, 200 or 150 dpi as printed, and compress it. Small is for email and uploads.

**Keep the file under** is optional: give a size in MB and Collated tries lower quality, step by step, until the file fits. If it can't, it says so and saves the smallest it made.

## Searchable text (OCR)

**Make text searchable** recognises English text on image pages, and on PDF pages that go into the file as an image (ones with a hidden layer), and adds it to the PDF invisibly, under the picture, so you can search the PDF and copy from it. It reads each page as you see it, crop and rotation included. Recognition runs on your device. The first time, it downloads about 4 MB of recognition data (from Collated's own site, not a third party); after that, it takes a few seconds per page. Anyone with the file can search and copy the text, and the recognised text may contain mistakes.

## Page numbers

Adds a number to every page: bottom centre, bottom right or top right, starting from any number.

## Password

**Password to open** encrypts the PDF (AES-256); it opens only with the password. Once open, nothing is restricted. Not hidden: the file's name, which comes from the title, and how many pages it has. The password isn't saved anywhere: if you lose it, the file can't be opened. **Show** reveals what you've typed. Passwords can be up to 127 bytes (roughly 60–120 characters, depending on the alphabet).
