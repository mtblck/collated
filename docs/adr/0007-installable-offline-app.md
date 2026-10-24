---
public: true
---

# 0007: An installable app, offline after the first visit, by our own service worker

- **Status:** Accepted
- **Date:** 2026-10-24
- **PR:** (this PR)

## Context

#73 asks for Collated to install as an app, show up in the system share sheet
and "Open with", and keep working with no connection. All three need a web app
manifest and a service worker, and the share target's POST has to be answered
by the worker, because there is no server. The constraints: a deploy must
still reach people (today the next page load gets the new build, and a tab
opened earlier gets the stale-build message from #42/#46); the lazy chunks
must be there offline (pdf.js, the export worker); the CSP must not widen.

The build is about 3.4 MB of app, pdf.js, export worker, fonts and docs pages,
plus 1.6 MB of HEIC decoder and 6.8 MB of OCR (the one of three engine variants
a browser picks, and the English data). Workbox (via vite-plugin-pwa) would
generate the worker, but adds a dependency tree and a second build config for
about 150 lines of our own; precaching everything would make every first visit
download 12 MB, mostly for features most visits never touch.

## Decision

We write the worker ourselves (`src/sw/`), and a Vite plugin
(`service-worker.ts`) builds it on its own into one classic `/sw.js` with the
build's file lists written in. On install it caches the **shell** (everything
in the build but source maps, licence texts, robots.txt, HEIC and OCR) under a
cache named by a hash of those files. HEIC and OCR go in an **on-demand**
cache the first time they're fetched, named by a hash of their contents, so it
survives deploys that don't change them. Page loads go to the network first
(4 s, then the cached copy), so a deploy shows up on the next load exactly as
before; the build's own files come from the cache. The new worker takes over
at once and deletes caches no build of its own uses; anything not in its lists
goes to the network untouched, so an old tab asking for a deleted chunk still
gets the 404 and the stale-build message. A share is kept in a third cache,
`collated-share-inbox`, until the app opens on `/?share=<id>` and takes it.
Files shared or opened join the work in progress; a document kept from last
time (ADR 0002) is restored first rather than replaced.

## Consequences

Installed or not, Collated opens and works with no connection after one
online visit, and HEIC and OCR after one use each; verify checks it with the
server down. First visits download the 3.4 MB shell in the background after
the page has loaded. sw.js must never be cached by HTTP (`hosting:check`
requires `Cache-Control: no-cache`), and the plugin fails the build if the
HEIC or OCR files stop matching its patterns, so a rename can't quietly add
megabytes to every first visit. No CSP change: the worker is `'self'` and the
manifest was already allowed. Share target and file handlers are Chromium
features (Android, ChromeOS, desktop Chrome and Edge); Safari and Firefox
install and work offline but don't offer them. Revisit if the shell grows past
about 10 MB, or if people want to choose when an update applies.
