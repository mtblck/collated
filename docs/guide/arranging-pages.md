---
public: true
order: 3
---

# Arranging pages

Select a page to edit it in the panel on the right. The large preview there is exactly what the PDF page will look like. Click or tap it to see the page full screen, at full resolution: pinch (or use a trackpad pinch, Ctrl + scroll, or the + and − keys) to zoom, and drag to move around. **0** fits the page again; Escape closes it.

## Several pages at once

- **Shift-click** a page to select every page from the last one you picked to this one. **⌘-click** (Ctrl-click on Windows and Linux) adds or removes one page. With the keyboard, hold Shift or ⌘/Ctrl and press Enter on a page.
- **⌘A** / **Ctrl+A** selects every page; **Escape** goes back to one.
- On a phone or tablet, tap **Select** above the pages, then tap each page you want; each one shows a check mark.

With more than one page selected, the panel changes everything you've selected at once: rotate, straighten (or auto-straighten), scale, placement, filter, move earlier or later, duplicate, reset and remove. Each change is one step for **Undo**. A filter changes only image pages; PDF pages keep their vector content. Dragging any selected page moves them all, together, to where you drop it, and so does picking one up with the keyboard.

## Several pictures on one page

For both sides of an ID card on one page, or a few receipts on a sheet: select the pages, then under **Combine onto one page** choose

- **2 per page:** two pictures along the page's long side, stacked or side by side, whichever shows them larger (with **Auto** orientation).
- **4 per page:** four pictures in a 2 × 2 grid.
- **ID card:** both sides at real card size, 85.6 × 54 mm, one above the other in the middle of the page. Crop each side to the card's edges first (**Crop to the page…**) for an exact-size copy.

More pictures than fit make more pages; a page that isn't full keeps its empty space, so every picture is the same size. Each picture keeps its own rotation, straightening, crop and filter. The combined page is one page: move, duplicate or remove it like any other, and **Rotate** turns each picture on it. Change its layout in the panel, or **Split** it to get the pictures back as separate pages (to edit one, split, change it, and combine again). With **Match image** page size, the page is made big enough to hold each picture at its own size.

## Order

- Drag a page by its handle (⠿).
- Or, with the keyboard: Tab to the handle, press Space to pick the page up, use the arrow keys to move it, and Space to drop it (Escape cancels).
- Or use **Move earlier** / **Move later** in the panel.

The toolbar's **More** menu reorders the whole document at once, or just the selected pages when several are selected (they stay in the places they hold). Each is one step, so **Undo** puts the pages back.

- **Interleave fronts and backs…** is for a two-sided scan made one side at a time: a pile of fronts, then a pile of backs. It puts them in order front 1, back 1, front 2, back 2, and so on. If you added the two piles as two files (or two batches of photos), or selected two separate groups of pages, those are the piles; otherwise the first half of the pages are taken as fronts. **Backs are in reverse order** is on by default, because turning the stack over and scanning it again brings the last back out first. If one pile has more pages, the extra pages go at the end.
- **Reverse page order** turns the document back to front.
- **Sort by file name** puts numbers in order (scan 2 before scan 10). **Sort by date taken** uses the date the photo was taken, if the camera recorded one, and otherwise the file's date.

## Rotate, straighten and scale

- **Rotate** turns the page a quarter turn left or right. To turn every page at once, use **Rotate all pages** in the toolbar's **More** menu.
- **Auto-rotate pages**, also in the **More** menu, turns upside-down and sideways pages the right way up by reading their text (the selected pages, when several are selected). It's one step for **Undo**, and the status line names the pages it turned. Pages without enough text to go by, like photos, are left as they are, and it says how many. On a page holding several pictures, each picture is turned on its own. The first time, it downloads about 6 MB (from Collated's own site).
- **Straighten** tilts the page up to 45° either way, to fix a crooked scan. **Auto-straighten** finds the angle from the lines of text; **All pages** does every page.
- **Scale** shrinks or enlarges the image on its page (10–400%).
- **Placement:** **Fit** shows the whole image; **Fill** covers the page edge to edge, cropping what overflows. Parts of an image that don't show on the page are left out of the PDF.

## Crop to the paper

For a photo of a document taken at an angle, **Crop to the page…** opens an editor where you drag each corner onto a corner of the paper. The page is then flattened into a straight rectangle. Collated looks for the paper first: if it finds a sheet, the editor opens with the corners already on it, so you only check them and apply. If it doesn't, they start at the corners of the whole photo. Nothing is cropped until you choose **Apply crop**. The editor shows the page turned the way you turned it. To crop with straight sides, drag the handle in the middle of an edge: it moves that whole side in or out.

Without dragging: tap or click a corner to select it, then tap or click where it should go. With the keyboard, select a corner and use the arrow keys (hold Shift for bigger steps).

**Auto-crop all pages** crops every photo to the paper it finds, in one step that a single Undo takes back. Pages you've already cropped keep their corners, and pages where no clear sheet is found are left as they are; the status line says how many of each.

## Black out part of a page

To hide an account number, an ID number or anything else before you send the PDF, choose **Black out part of the page…** and drag a box over it. Draw as many boxes as you need, drag one to move it, or drag its corner to size it; **Apply** puts them on the page, and **Undo** takes them back. Without dragging: **Add a box** puts one in the middle, then tap the box (or its corner) and tap where it should go. With the keyboard, use **Add a box**, then the arrow keys on the box or its corner (hold Shift for bigger steps); Delete removes it.

The editor shows the whole photo, so a box stays on what it covers if you crop, rotate or change the placement later. **Reset** and **Apply to all pages** leave boxes alone; **Remove all** in the panel takes them off.

**What is removed.** Many tools only draw a box on top, so the text is still in the file and can be copied out from under it. Collated removes it:

- On a photo or scan, the pixels under each box are painted black before anything else happens to the image. The original pixels aren't in the PDF.
- A PDF page with a box goes into the file as a picture of the page, with the boxes painted on. None of its text, fonts or drawing come with it, so nothing under a box can be selected, searched or copied. The rest of that page's text can't be either, unless you turn on **Make text searchable** when you export; then it's read from the picture, and words under or touching a box are left out. If you duplicated the page, the copies go in as a picture too.
- Searchable text never includes a word under or touching a box.

**What isn't.** Only what's under the boxes. A number that also appears elsewhere on the page, or on another page, needs its own box. The file you started from is unchanged, and the copy of your work kept on this device still holds it as it was, until you **Start over** (see [Privacy and security](privacy-and-security.md)).

## Filters

- **Original:** as photographed.
- **Greyscale:** removes colour casts.
- **Enhance:** whitens the paper and evens out shadows while keeping the colours of ink, stamps, highlighter and logos. Best for colour documents photographed with a phone; crop to the paper first so the table isn't lightened too.
- **B&W:** pure black and white for text, even when the page was lit unevenly. Saved losslessly, so text edges stay sharp.

## Duplicate, reset and remove

**Duplicate** copies the page (it doesn't add to the file size). **Reset** undoes this page's changes. **Apply to all pages** copies this page's rotation, straightening, scale, placement and filter to every page. **Remove** takes the page out; **Undo** brings it back. To clear everything and begin a new document, use **Start over…** in the toolbar's **More** menu (this can't be undone).

## Blank pages

Scanning single-sided paper on both sides leaves every other page blank. Collated checks each page as it arrives and marks the ones that look blank with **Looks blank** (a screen reader hears it in the page's name). Faint show-through from the other side, punch holes, specks of dust and the scanner's shadow at the edge don't count as content; a single line of text or a signature does. Dark or coloured paper is never marked.

Nothing is removed on its own. Above the pages, **Remove N blank pages** takes out every marked page at once, as one step for **Undo**. To check them first, or keep one, use **Select them**, deselect any page you want to keep (⌘/Ctrl-click), and **Remove** the rest from the panel.
