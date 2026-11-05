---
public: true
---

# 0029: Task pages are static pages that open the app with the task ready

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** [#144](https://github.com/mtblck/collated/pull/144)

## Context

The big PDF suites get most of their search traffic from one page per task
("jpg to pdf", "sign pdf"). Collated had one landing page, and the app is a
single-page React app: a route like `/sign-pdf` rendered by React would reach
search engines as the same `index.html`, with the home page's title,
description and canonical URL. Server rendering would need a framework or a
server, which Collated doesn't have (ADR 0007, "talks to nobody").

## Decision

We build six task pages (JPG, merge, scan, sign, compress, HEIC) as static
HTML in `docs-site.ts`, from plain data in `src/components/tasks.ts`, with the
docs pages' header, footer, stylesheet and CSP, plus `sitemap.xml`. Each page
has its own title, description, canonical URL and how-to, and one button to
the app at `/?task=<slug>`. The app reads the task once: its words go on the
landing view's drop target, and when the first files come in it readies the
task's part (Sign: the first page's Sign button focused and in view;
Compress: image quality Small, with a notice; Scan: Scan pages first), then
drops `?task=` from the address. Task pages load the page-view count
(ADR 0015) because search arrivals are what they are for; docs pages still
don't.

## Consequences

- Adding a task is one entry in `tasks.ts`; `hosting:check` then insists on
  its slash redirect in `vercel.json`, and the tests check its links, its
  guide page and its place in the footer and sitemap.
- The copy promises what the app does: change both together.
- Opening the file picker straight from the task page isn't possible (a
  picker needs a tap on the page that owns the input), so it is two taps:
  the page's button, then the app's.
