/**
 * Files that reach Collated from outside the page (#73): shared to it from
 * another app (the manifest's share_target, via the service worker's inbox)
 * or opened with it from the desktop (file_handlers, via the launch queue).
 * Both can arrive before React has mounted, so they wait here for the app.
 */
import { INBOX_CACHE, NAME_HEADER, SHARE_PARAM, inInbox } from '../sw/routes'

/**
 * What arrived: files, or a share that carried none Collated could keep.
 * Shared files are asked about before they go in (any site can post to the
 * share address); files opened from the desktop were chosen by the person.
 */
export type Incoming = { files: File[]; from: 'share' | 'launch' } | { empty: 'share' }

type Listener = (incoming: Incoming) => void
let listener: Listener | null = null
const waiting: Incoming[] = []

const deliver = (incoming: Incoming) => {
  if (listener) listener(incoming)
  else waiting.push(incoming)
}

/** Hands `fn` everything that has arrived and will arrive; returns the unsubscribe. */
export const listenForIncoming = (fn: Listener) => {
  listener = fn
  for (const incoming of waiting.splice(0)) fn(incoming)
  return () => {
    if (listener === fn) listener = null
  }
}

/** Takes share `id`'s files out of the inbox, in the order they were shared. */
export const takeShared = async (id: string, storage: CacheStorage): Promise<File[]> => {
  const inbox = await storage.open(INBOX_CACHE)
  const keys = (await inbox.keys())
    .filter((request) => inInbox(id, request.url))
    .sort((a, b) => (a.url < b.url ? -1 : 1))
  const files: File[] = []
  for (const key of keys) {
    const response = await inbox.match(key)
    if (!response) continue
    const blob = await response.blob()
    const name = response.headers.get(NAME_HEADER)
    files.push(
      new File([blob], name ? decodeURIComponent(name) : 'Shared file', { type: blob.type }),
    )
  }
  await Promise.all(keys.map((key) => inbox.delete(key)))
  return files
}

interface LaunchParams {
  files: readonly { kind: string; getFile?: () => Promise<File> }[]
}
interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void
}

/**
 * Starts listening: picks up a share named in the address (then drops it
 * from the address, so a reload doesn't look for it again) and files the
 * installed app was opened with.
 */
export const startIncoming = (win: Window = window) => {
  const url = new URL(win.location.href)
  const id = url.searchParams.get(SHARE_PARAM)
  if (id !== null) {
    url.searchParams.delete(SHARE_PARAM)
    win.history.replaceState(win.history.state, '', url.pathname + url.search + url.hash)
    void takeShared(id, win.caches)
      .catch((error: unknown) => {
        console.error(error)
        return []
      })
      .then((files) => {
        deliver(files.length > 0 ? { files, from: 'share' } : { empty: 'share' })
      })
  }
  const queue = (win as Window & { launchQueue?: LaunchQueue }).launchQueue
  queue?.setConsumer((params) => {
    const reads = params.files.flatMap((h) => (h.kind === 'file' && h.getFile ? [h.getFile()] : []))
    void Promise.all(reads)
      .then((files) => {
        if (files.length > 0) deliver({ files, from: 'launch' })
      })
      .catch((error: unknown) => {
        console.error(error)
      })
  })
}

/**
 * Registers the service worker once the page has loaded, so its install
 * (the app's files, a few megabytes) doesn't compete with the first paint.
 * Production only: in development it would cache files Vite is changing.
 */
export const registerServiceWorker = (win: Window = window) => {
  if (!('serviceWorker' in win.navigator)) return
  const register = () => {
    win.navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch((error: unknown) => {
        // Collated still works without it, just not offline.
        console.warn('Service worker not registered', error)
      })
  }
  if (win.document.readyState === 'complete') register()
  else win.addEventListener('load', register, { once: true })
}

/** For tests: forget the listener and anything waiting. */
export const resetIncoming = () => {
  listener = null
  waiting.length = 0
}
