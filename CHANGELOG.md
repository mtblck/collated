# Changelog

What changed for people using Collated, newest first. Each merged PR with a
user-visible change gets a line under **Unreleased** (the `changelog.yml`
workflow adds it, unless the PR wrote its own); the `release` skill
(`maintenance` plugin) moves them under a version or date when it ships.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Added

- Select several pages at once (#65): Shift-click for a range, ⌘/Ctrl-click for one more, ⌘A / Ctrl+A for all, or **Select** on a phone. Rotate, straighten, scale, filter, move, duplicate or remove them together, each as one undo step, and drag any of them to move them all.
- Blank pages (#68): pages that look blank (allowing for show-through, punch holes and dust) are marked **Looks blank**, and **Remove N blank pages** above the pages takes them all out in one undoable step. Nothing is removed without asking.
- Crop to the page now finds the paper in a photo and opens with the corners already on it, ready to check and apply. **Auto-crop all pages** crops every photo to its paper in one undoable step, leaving pages you've already cropped alone.
- Two-sided scans: **Interleave fronts and backs** in the More menu puts a pile of fronts and a pile of backs (reversed or not) into page order in one step. Also there: **Reverse page order**, **Sort by file name** and **Sort by date taken**.
- Your work survives a reload or a closed tab: the document, undo history included, is kept in this browser on this device (never uploaded, never the password), and Collated offers **Restore your last document?** next time. Start over deletes it, and **Keep work after a reload** in the More menu turns it off.

### Changed

- A new look, the light table: pages lie on a softly lit dark ground (or a pale one in the light theme), the toolbar and the selected page's settings float above them, and the landing page matches. New type (Geist) and an amber accent.

### Fixed

### Security
