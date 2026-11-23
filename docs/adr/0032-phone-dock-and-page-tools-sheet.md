---
public: true
---

# 0032: On a phone, add and export sit in a dock; below lg, page tools are a sheet

- **Status:** Accepted
- **Date:** 2026-11-23
- **PR:** [#158](https://github.com/mtblck/collated/pull/158)

## Context

With the header pinned to the top (#157), a phone's workspace header was
three rows: the name, then the toolbar's two (setup, undo, redo / add,
export, More), about 150 px of an 844 px screen. Below lg the inspector had
no column of its own, so it sat under the whole grid: to fix page 2 of 20 you
scrolled past every page, and back up to see the result. Three layouts were
mocked up (a floating dock, an app tab bar, a filmstrip editor); Matt picked
the dock, the smallest change from the desktop layout.

## Decision

Below sm the header is one row: the name, then page setup (its icon), undo,
redo and More. Add, Take photo, Scan and Export sit in a dock floating along
the bottom, under the thumb; the landing view has its own dock with the ways
in and the Support heart (tipjar's floating button is hidden there). Below lg
the inspector opens as a sheet over the pages when a page is tapped (or
**Edit** in Select mode), with the rest dimmed and inert; its ✕, Escape or a
tap on the dimmed pages closes it and focus goes back to the page. The
toolbar is one `DocumentBar` with a `part` prop (`bar`, `top`, `dock`),
chosen by `useMediaQuery` against the same breakpoints as the CSS; the page
keeps `--dock-room` at its end and lifts notices above the dock.

## Consequences

The desktop and tablet toolbars are unchanged, and the inspector's contents
are the same everywhere; only their containers change. Below lg the page
tools are a tap away rather than a scroll away, but no longer visible beside
the pages while you work. Anything new that floats at the bottom of a phone
screen must sit above `--dock-room`. A tab bar or a filmstrip would be the
next step if the workspace grows more modes than one sheet can hold.
