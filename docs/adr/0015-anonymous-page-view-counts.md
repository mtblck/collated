---
public: false
---

# 0015: Count page views with Vercel Web Analytics

- **Status:** Accepted
- **Date:** 2026-10-26
- **PR:** [#102](https://github.com/mtblck/collated/pull/102)

## Context

Matt wants to know how many people use his apps, on one private page
(mattblack.space/analytics) and at no cost. Collated promised no tracking and
nothing third-party loaded (ADR 0014's context), with CSP `script-src 'self'`.

## Decision

Load Vercel Web Analytics from Collated's own origin
(`/_vercel/insights/script.js`, via `public/analytics.js`, skipped on
localhost). It sets no cookies, stores nothing in the browser, and tells
repeat visits apart within a day by a request hash Vercel discards. It never
sees files or anything typed. The app counts views; the docs pages don't load it.
Google Analytics and other third-party trackers were ruled out (cookies,
consent banner, outside scripts).

## Consequences

- The privacy notice, guide, landing copy, README and CONTRIBUTING say "no
  cookies, only an anonymous page-view count" instead of "no tracking", and
  the privacy notice lists every data point Vercel records.
- The CSP is unchanged: the script and its beacon are same-origin.
- Turning it off means removing the script tag and the copy changes together.
