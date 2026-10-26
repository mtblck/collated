---
public: false
---

# 0016: Count exports through mattblack.space

- **Status:** Accepted
- **Date:** 2026-10-26
- **PR:** (this PR)

## Context

Page views (ADR 0015) say who opened Collated, not who made a PDF. Vercel's
free plan has no custom events. Boards runs one shared counter for every app
(`mattblack.space/boards/api/events`, mtblck/boards ADR 0003) that keeps per-day
totals and nothing about visitors. Collated's CSP is `connect-src 'self'` and
its tests fail on any request to another site.

## Decision

After each export the page beacons `exported` to `/_mb/events` on its own site,
which `vercel.json` rewrites to the shared counter. The body is the project and
event name only (`src/lib/track.ts`).

## Consequences

- The CSP and the "talks only to its own site" test are unchanged.
- Nothing is sent off collatedpdf.com, so local runs, previews and tests never count.
- The privacy notice, guide, README and CONTRIBUTING now say "page views and exports".
