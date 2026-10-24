/**
 * What the service worker does with each request (#73, ADR 0007). Pure, so
 * the strategy is unit-tested; `sw.ts` only carries it out.
 */

/** Written into sw.js at build time by `service-worker.ts`. */
export interface SwManifest {
  /** Names the shell cache: a hash of every file in it, so each build gets its own. */
  version: string
  /** Fetched on install: the app, its lazy chunks (pdf.js, export), docs pages. */
  shell: string[]
  /** Cached the first time something asks for them: HEIC decoding and OCR. */
  onDemand: string[]
  /** A hash of the on-demand files' contents: unchanged across most deploys. */
  onDemandVersion: string
}

export type Route =
  /** The share target's POST: files go to the inbox, the app opens on them. */
  | 'share'
  /** A page load: network first (so deploys show up), the cached copy offline. */
  | 'page'
  /** From the shell cache, filled on install. */
  | 'shell'
  /** From the on-demand cache, filled on first use. */
  | 'on-demand'
  /** Not ours to handle: the browser fetches it as if there were no worker. */
  | 'network'

/** Where the manifest's share_target posts. Never reaches the server. */
export const SHARE_PATH = '/share'

export const CACHE_PREFIX = 'collated-'
export const shellCache = (manifest: SwManifest) => `${CACHE_PREFIX}shell-${manifest.version}`
export const onDemandCache = (manifest: SwManifest) =>
  `${CACHE_PREFIX}on-demand-${manifest.onDemandVersion}`

export interface RequestInfo {
  method: string
  url: string
  mode: string
}

export const routeFor = (manifest: SwManifest, request: RequestInfo, origin: string): Route => {
  const url = new URL(request.url)
  if (url.origin !== origin) return 'network'
  if (request.method === 'POST' && url.pathname === SHARE_PATH) return 'share'
  if (request.method !== 'GET') return 'network'
  if (request.mode === 'navigate') return 'page'
  if (manifest.shell.includes(url.pathname)) return 'shell'
  if (manifest.onDemand.includes(url.pathname)) return 'on-demand'
  return 'network'
}

/**
 * The cached page to show offline for a navigation: a docs page if it's
 * one we keep, else the app (every other path the server answers with
 * index.html too, which the shell keeps under "/").
 */
export const offlinePage = (manifest: SwManifest, pathname: string) =>
  pathname !== '/' && manifest.shell.includes(pathname) ? pathname : '/'

/** Every cache this build doesn't use: deleted once it takes over. */
export const staleCaches = (manifest: SwManifest, names: readonly string[]) => {
  const keep = new Set([shellCache(manifest), onDemandCache(manifest), INBOX_CACHE])
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
}

/**
 * Shared files wait here between the service worker taking the POST and the
 * page reading them. Cache entries, not IndexedDB: both sides already have
 * the Cache API, and a Response keeps a File's bytes and type as they are.
 */
export const INBOX_CACHE = `${CACHE_PREFIX}share-inbox`
/** The original filename rides along in a header (URI-encoded: headers are Latin-1). */
export const NAME_HEADER = 'X-Collated-Name'
/** The query parameter that tells the app which share to pick up. */
export const SHARE_PARAM = 'share'

const inboxPrefix = (id: string) => `/share-inbox/${encodeURIComponent(id)}/`
/** The cache key for the `index`th file of share `id`; zero-padded so keys sort in order. */
export const inboxKey = (id: string, index: number) =>
  `${inboxPrefix(id)}${String(index).padStart(4, '0')}`
/** Whether a cached URL belongs to share `id`. */
export const inInbox = (id: string, url: string) =>
  new URL(url).pathname.startsWith(inboxPrefix(id))
