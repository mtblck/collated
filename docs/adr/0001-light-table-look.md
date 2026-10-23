---
public: true
---

# 0001: The app looks like a light table

- **Status:** Accepted
- **Date:** 2026-10-23
- **PR:** (this PR)

## Context

Collated shared mb-portfolio's look: warm paper, Instrument Serif over
Archivo, a vermillion accent and a paper grain. Tuning it (a sunk work
area, a lifted rail, a dot grid that was rejected) kept running into the
same limit: pages on cream paper don't stand out, and a serif display face
reads as a stationery site rather than a tool. A design exploration put four
refinements and four new directions side by side; the light table was chosen
as the most complete and the easiest to extend.

## Decision

We draw the workspace as a light table: pages lie on a dark, softly lit
ground and glow slightly, the toolbar and the selected page's settings
float above it as panels, and one amber accent (the safelight) marks focus,
selection and the primary action. Destructive actions get their own red.
Type is Geist and Geist Mono, self-hosted. The light theme is the same
table by daylight, with the amber darkened to ochre so it holds AA as text.
The theme still follows the system unless the visitor picks one.

## Consequences

Collated no longer shares the portfolio's palette or faces; the `--c-*`
token names stay, so components didn't change shape. Panels are drawn by
shadow rather than borders (`shadow-panel`), and button corner radii ride
with the size prop, like padding. Pages are never tilted for decoration:
on a tool that straightens and rotates, a tilted thumbnail would be a lie.
