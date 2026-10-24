/**
 * Collated's service worker (#73, ADR 0007): keeps the app working offline
 * and takes the share target's POST, which has no server to go to.
 *
 * Built on its own by `service-worker.ts` into one classic script, /sw.js,
 * with the build's file lists written in where `__SW_MANIFEST__` stands.
 * The strategy itself is in routes.ts.
 */
import {
  INBOX_CACHE,
  NAME_HEADER,
  SHARE_PARAM,
  inboxKey,
  offlinePage,
  onDemandCache,
  routeFor,
  shellCache,
  staleCaches,
  type SwManifest,
} from './routes'

declare const __SW_MANIFEST__: SwManifest
const manifest = __SW_MANIFEST__

// The DOM lib types `self` as a Window; these are the parts of a service
// worker's global scope used here.
interface ExtendableEvent extends Event {
  waitUntil: (work: Promise<unknown>) => void
}
interface FetchEvent extends ExtendableEvent {
  request: Request
  respondWith: (response: Promise<Response>) => void
}
interface Scope {
  location: Location
  skipWaiting: () => Promise<void>
  clients: { claim: () => Promise<void> }
  addEventListener: ((type: 'install' | 'activate', fn: (e: ExtendableEvent) => void) => void) &
    ((type: 'fetch', fn: (e: FetchEvent) => void) => void)
}
const scope = self as unknown as Scope

/** How long a page load waits for the network before showing the cached copy. */
const PAGE_TIMEOUT_MS = 4000

scope.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(shellCache(manifest))
      // `cache: 'reload'` skips the HTTP cache, so the files match this build.
      await cache.addAll(manifest.shell.map((path) => new Request(path, { cache: 'reload' })))
      // A new build takes over at once. Pages load from the network first, so
      // an open tab is already on the newest build or about to be; one still on
      // an older one meets the stale-build message (#42) as without a worker.
      await scope.skipWaiting()
    })(),
  )
})

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(staleCaches(manifest, await caches.keys()).map((n) => caches.delete(n)))
      await scope.clients.claim()
    })(),
  )
})

scope.addEventListener('fetch', (event) => {
  const route = routeFor(manifest, event.request, scope.location.origin)
  if (route === 'network') return
  event.respondWith(
    route === 'share'
      ? share(event.request)
      : route === 'page'
        ? page(event.request)
        : route === 'shell'
          ? fromShell(event.request)
          : onDemand(event.request),
  )
})

const pathOf = (request: Request) => new URL(request.url).pathname

/** Network first, so a deploy shows up on the next load; the cached copy if offline or slow. */
const page = async (request: Request) => {
  const cached = async () =>
    (await caches.open(shellCache(manifest))).match(offlinePage(manifest, pathOf(request)))
  const network = fetch(request)
  // Settled later if the cached copy wins the race; a failure then is no news.
  network.catch(() => undefined)
  const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS))
  try {
    const first = await Promise.race([network, timeout])
    if (first) return first
    return (await cached()) ?? (await network)
  } catch (error) {
    const copy = await cached()
    if (copy) return copy
    throw error
  }
}

/** The shell is complete once installed; a miss (a cleared cache) goes to the network. */
const fromShell = async (request: Request) =>
  (await (await caches.open(shellCache(manifest))).match(pathOf(request))) ?? fetch(request)

/** Cached by path the first time it's fetched (tesseract adds no query, but be sure). */
const onDemand = async (request: Request) => {
  const cache = await caches.open(onDemandCache(manifest))
  const key = pathOf(request)
  const hit = await cache.match(key)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(key, response.clone())
  return response
}

/** Files shared to Collated: kept in the inbox, then the app opens and takes them. */
const share = async (request: Request) => {
  const id = crypto.randomUUID()
  try {
    const form = await request.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
    const inbox = await caches.open(INBOX_CACHE)
    await Promise.all(
      files.map((file, i) =>
        inbox.put(
          inboxKey(id, i),
          new Response(file, {
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              [NAME_HEADER]: encodeURIComponent(file.name),
            },
          }),
        ),
      ),
    )
  } catch (error) {
    // The app still opens; it finds nothing to add and says so.
    console.error(error)
  }
  const url = new URL('/', scope.location.origin)
  url.searchParams.set(SHARE_PARAM, id)
  // 303: the browser follows with a GET, so a reload doesn't post again.
  return Response.redirect(url.href, 303)
}
