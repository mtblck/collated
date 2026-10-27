---
public: true
order: 90
---

# Privacy notice

_Last updated 27 October 2026._

Collated is a free, open-source tool. It is built so that your documents never leave your device, and this notice explains exactly what that means.

## Your documents

The files you add, the pages you arrange and the PDFs you export are processed only in your web browser. They are never uploaded, and nobody, including the author, can see them. While the page is open they're kept in its memory, including pages you removed, so Undo can bring them back. So that a reload or a closed tab doesn't lose your work, a copy is also kept on your device (see below) until you start over, discard it or turn that off. **Start over** (in the toolbar's **More** menu) clears all of it, the copy on your device included, straight away. A PDF you saved stays where you saved it.

## What is stored on your device

- **Your settings** (page setup, image dpi for Match image, export quality and size limit, the searchable-text choice and its language, the page-number and file-bookmark choices, and how a watermark looks) are saved in your browser's local storage under `collated:settings`, so they're there next time. Your title, your watermark's text and your password are never saved there.
- **Your current document,** so you can pick up where you left off after a reload or a closed tab: the files you added (each stored once), their small previews, the page order and settings, the section names, the title, and the undo history. It's kept in your browser's IndexedDB (a database called `collated-work`) on this device only, and next time you open Collated it asks **Restore your last document?** The password is never stored. **Discard** on that question, **Start over**, or turning off **Keep work after a reload** (in the **More** menu) deletes it straight away; with that setting off (remembered as `collated:keep-work`) nothing about your document is stored. If a document is too large for the space your browser allows, Collated tells you and keeps nothing of it.
- **Your light or dark theme choice** (`mb-theme`).
- **When Collated last asked for support** (`collated:support-prompt`): the date it last showed the note after an export, or `off` once you choose **Don’t ask again** or follow one of its links. Nothing about the export itself.
- **Collated itself,** so it opens and works without a connection: its code, fonts and help pages, and once you've used them the HEIC decoder and the text-recognition engine, are kept in your browser's Cache Storage. They contain nothing about your documents. Files you share to Collated from another app wait there too, for the moment it takes the app to open, and are then deleted.
- **Text-recognition data:** if you use searchable text, the recognition data for each language you've used (1–8 MB once unpacked) is cached in your browser's IndexedDB so it doesn't download again; so is the orientation data (about 11 MB unpacked) if you use **Auto-rotate pages**. Neither contains anything about your documents.

You can clear all of this in your browser's site settings. There are no cookies.

## What the hosting sees

Collated is a set of static files served by Vercel, at collatedpdf.com. Like any website, the host receives standard request information when your browser fetches those files: your IP address, your browser's user agent, the time, and which file was requested (for example, the text-recognition data when you first use searchable text). This is used for running and securing the service, not for tracking you.

Collated counts page views with [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy), so we know how many people use it. It sets no cookies and stores nothing in your browser; Vercel records the time, the page (with any query string stripped of anything identifying), the referring site, your country, region and city, your browser, operating system and their versions, and your device type, and recognises a repeat visit within a day only through a hash it discards. It never sees your pictures, documents or anything you type. See [Vercel's privacy policy](https://vercel.com/legal/privacy-policy).

Collated also counts how many PDFs are exported. Each time you export, the page sends the single word "exported" to its own site, which passes it on to mattblack.space, the site of Collated's maker, where it is added to that day's total. The count holds the word and the day only: nothing about you, your files or your settings.

Each page you open is also added to a daily page-view total there. When you arrive from another site, the page also sends that site's name (for example google.com), which mattblack.space turns into a kind of place (a search engine, LinkedIn, another site) and then forgets; only the day's count for that kind is kept. No cookie, IP address or identifier is stored, and nothing about which page you were on.

## Links out

**Support Collated** goes to Ko-fi, **GitHub Sponsors** to GitHub Sponsors and **Source code** to GitHub. Those sites have their own privacy policies and only see you if you follow the link.

## Contact

Questions about privacy: [open an issue on GitHub](https://github.com/mtblck/collated/issues). Collated is made by Matt Black.
