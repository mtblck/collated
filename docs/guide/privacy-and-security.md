---
public: true
order: 7
---

# Privacy and security

## Your files stay on your device

Collated is a web page that does all its work in your browser. There is no server that receives your files, no account and no analytics. The page's security policy forbids it to send anything anywhere; it may only load its own files from its own site. (Our automated tests fail if it ever tries.)

What the site does download, the first time you need it: the code that reads PDFs and HEIC photos, the 4 MB of text-recognition data for searchable text, and the 6 MB that Auto-rotate pages uses to tell which way up a page is. These come from Collated's own site, and the host can see they were fetched, but not what you used them on.

The [privacy notice](../privacy.md) has the full detail, including what is kept on your device.

## What goes into the PDF

Only what you see on the pages, and what you chose to add:

- **No photo metadata.** Phones store the camera, the time and often the GPS location inside each photo. Collated removes all of it before the image goes into the PDF; the picture itself is unchanged.
- **No hidden parts.** If Fill or scaling hides part of an image, that part isn't stored.
- **PDF pages bring only what they show.** Filled-in form fields, stamps, signatures and highlights are drawn onto the page as they look; the form data behind them, comment text, attachments, scripts and the original file's metadata are left out, and so are images from pages you removed. A PDF page with a hidden layer is exported as it looks, as an image, so nothing hidden comes with it. Its own text can't be selected, but **Make text searchable** reads it from that image. Anything a PDF page draws outside its visible area is still there, clipped (as it was in the original).
- **Searchable text,** only if you turn it on.
- **The title** you gave, "Collated" as the creating tool, and the date (without the time of day).

## Your work is kept on this device

So that a reload, a crashed tab or a phone closing the page in the background doesn't lose your work, Collated keeps a copy of the document in your browser's storage on this device as you go: the files, the pages, your settings and the undo history. It never leaves the device, and the password is never part of it. Next time you open Collated it asks **Restore your last document?**: **Restore** brings it back, undo history and all; **Discard** deletes it. If you add files instead, they start a new document, which replaces the saved one.

On a shared computer, or if you'd rather nothing were kept, turn off **Keep work after a reload** in the toolbar's **More** menu; that deletes the copy and stops keeping one. A very large document may not fit in the space the browser allows; Collated says so, and then keeps nothing, so export before you close the tab.

## Passwords

A password encrypts the PDF's content with AES-256. The filename and the page count aren't hidden. Collated keeps the password in memory while the page is open and never stores it, not even with the copy of your work kept on this device; closing or reloading the tab forgets it.

## Starting over

Pages you remove stay in the page's memory so **Undo** can bring them back. On a shared computer, **Start over** in the toolbar's **More** menu clears everything at once: the pages (removed ones too), the undo history, recognised text, the password and the copy kept on this device. It can't be undone. Your page setup is kept.

## Open source

The [source code](https://github.com/mtblck/collated) is public (MIT licence), so all of this can be checked. Security problems: please open an issue, or report it privately through GitHub's security advisories.
