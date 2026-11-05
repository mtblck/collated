---
public: true
order: 2
---

# Adding pages

Drop files anywhere on the page, use **Choose files** (or **Add pages** once you've started), or paste images from the clipboard. New pages go after the ones you have.

## Taking photos on a phone

On a phone or tablet, **Take photo** (the camera button in the toolbar once you've started) opens your camera. Take the picture, confirm it, and it's added after the last page; press **Take photo** again for the next one. Each shot is named by the time it was taken, such as "Photo 14.03.22.jpg".

Your phone's own camera app takes the picture, so Collated never asks for camera access and never sees the camera except for the photos you confirm. iPhone photos in HEIC work like any other. For the straightest result, lay the page on a darker surface: **Crop to the page…** then finds the paper's corners for you (see [Arranging pages](arranging-pages.md)).

## Scanning a stack of pages

For more than a few pages, **Scan pages** (next to **Take photo**) keeps the camera open inside Collated. Hold the phone over a page: Collated outlines the paper, and once the outline holds still for a moment it takes the page by itself, already cropped to the outline. Turn to the next page (your hand covering the page tells it a new one is coming) and it takes that one too. The count at the bottom says how many you have; choose **Done** when you're finished. Each page is named by when it was taken, such as "Scan 14.03.22.jpg", and goes after the last page, so you can check and fix any of them afterwards.

- **Auto** turns taking pages by themselves off and on (Collated remembers your choice). With it off, or when the page fills the screen and has no outline, tap the round shutter button.
- **Light** turns on your phone's light, where the browser allows it (Chrome on Android does; iPhones don't).
- The first time, your browser asks whether Collated may use the camera. If you say no, or the camera is busy, Collated offers **Take photo** instead. The camera stops as soon as you close the scanner or switch away from Collated, and nothing it sees leaves your phone.

## From other apps

Install Collated as an app (the install button in Chrome or Edge's address bar, or **Add to Home screen** on a phone) and it opens like any other app, with or without a connection. On Android, ChromeOS and in desktop Chrome and Edge it also appears:

- **In the share sheet:** share photos from your gallery or a PDF from an email to **Collated**, and they open as pages.
- **In "Open with":** right-click a PDF or image on your computer and open it with Collated.

Before shared files go in, Collated names them and asks **Add N files shared with Collated?**, because any website could try to send files there; choose **Add** only if you shared them yourself. Files you open with Collated go straight in. Either way they're added to the document you're working on. If you have one saved from last time, it's restored first and the new files go after its pages, so nothing you kept is replaced.

## What Collated reads

- **PDFs:** each page becomes a page you can move, rotate or remove. A PDF that needs a password to open (bank and payroll statements often do) asks for it: type it and choose **Open**, or **Skip this file** to leave it out. Collated opens it in your browser and keeps an unlocked copy, so the pages, their text and the exported PDF need no password; the password itself isn't kept. PDFs that only restrict editing or printing open without asking. Pages stay as sharp as the original at any size, except a page with a hidden layer, which goes into the PDF as an image of what you see (turn on **Make text searchable** to keep its text searchable).
- **JPEG and PNG:** go into the PDF as they are, without recompressing (see [Exporting](exporting.md)).
- **HEIC / HEIF** (iPhone photos): read in every browser, not only Safari.
- **TIFF** (scanners, fax machines and copiers): each page of a multi-page TIFF becomes a page, in order. Black-and-white pages, such as faxes, stay black and white, so the PDF stays small. Colour TIFF pages are converted once. With **Match image** page size, each page comes out the size of the paper that was scanned, from the resolution saved in the file.
- **WebP, AVIF, GIF and BMP:** converted once, because PDF can't hold them.

Phone photos are turned the right way up from the orientation the camera recorded. The file type is read from the file itself, not its name, so a mislabelled file still opens.

## Limits

- Images up to **100 megapixels** (for example 10,000 × 10,000 pixels). Larger ones are refused with a message, before your browser tries to load them.
- PDFs and TIFFs up to **500 pages** each.

Anything Collated can't read is listed in a message at the bottom of the screen, by name; the rest still comes in.
