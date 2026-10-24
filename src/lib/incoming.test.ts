// @vitest-environment node
// Node's own File and Response: jsdom's File can't be a Response body.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INBOX_CACHE, NAME_HEADER, inboxKey } from '../sw/routes'
import {
  listenForIncoming,
  resetIncoming,
  startIncoming,
  takeShared,
  type Incoming,
} from './incoming'

const ORIGIN = 'https://collatedpdf.com'

/** A Cache API with one cache's worth of behaviour, enough for the inbox. */
const fakeCaches = () => {
  const stores = new Map<string, Map<string, Response>>()
  const open = (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>()
    stores.set(name, store)
    const url = (key: RequestInfo) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href
    return Promise.resolve({
      put: (key: string, response: Response) => {
        store.set(url(key), response)
        return Promise.resolve()
      },
      keys: () => Promise.resolve([...store.keys()].map((u) => new Request(u))),
      match: (key: RequestInfo) => Promise.resolve(store.get(url(key))?.clone()),
      delete: (key: RequestInfo) => Promise.resolve(store.delete(url(key))),
    })
  }
  return { storage: { open } as unknown as CacheStorage, stores }
}

const share = async (storage: CacheStorage, id: string, files: File[]) => {
  const inbox = await storage.open(INBOX_CACHE)
  for (const [i, f] of files.entries()) {
    await inbox.put(
      inboxKey(id, i),
      new Response(f, {
        headers: { 'Content-Type': f.type, [NAME_HEADER]: encodeURIComponent(f.name) },
      }),
    )
  }
}

const file = (name: string, type = 'image/jpeg') =>
  new File([new Uint8Array([1, 2])], name, { type })

afterEach(() => {
  resetIncoming()
})

describe('files arriving from outside (#73)', () => {
  it('takes one share’s files out of the inbox, in order, names intact', async () => {
    const { storage, stores } = fakeCaches()
    const many = Array.from({ length: 11 }, (_, i) => file(`p${i}.jpg`))
    await share(storage, 'one', [...many, file('Ünïcode “name”.pdf', 'application/pdf')])
    await share(storage, 'two', [file('other.jpg')])
    const files = await takeShared('one', storage)
    expect(files.map((f) => f.name)).toEqual([...many.map((f) => f.name), 'Ünïcode “name”.pdf'])
    expect(files.at(-1)?.type).toBe('application/pdf')
    // Only that share is gone.
    expect(stores.get(INBOX_CACHE)?.size).toBe(1)
    expect(await takeShared('one', storage)).toEqual([])
  })

  it('holds what arrives until the app listens', () => {
    const got: Incoming[] = []
    const { storage } = fakeCaches()
    const launch: { consumer?: (p: { files: unknown[] }) => void } = {}
    const win = {
      location: { href: `${ORIGIN}/` },
      history: { state: null, replaceState: vi.fn() },
      caches: storage,
      launchQueue: {
        setConsumer: (fn: (p: { files: unknown[] }) => void) => {
          launch.consumer = fn
        },
      },
    } as unknown as Window
    startIncoming(win)
    const opened = file('opened.pdf', 'application/pdf')
    launch.consumer?.({
      files: [{ kind: 'file', getFile: () => Promise.resolve(opened) }, { kind: 'directory' }],
    })
    return vi.waitFor(() => {
      const stop = listenForIncoming((incoming) => got.push(incoming))
      expect(got).toEqual([{ files: [opened], from: 'launch' }])
      stop()
    })
  })

  it('picks up the share named in the address, then drops it from the address', async () => {
    const { storage } = fakeCaches()
    await share(storage, 'abc', [file('photo.jpg')])
    const replaceState = vi.fn()
    const win = {
      location: { href: `${ORIGIN}/?share=abc#top` },
      history: { state: { keep: 1 }, replaceState },
      caches: storage,
    } as unknown as Window
    const got: Incoming[] = []
    listenForIncoming((incoming) => got.push(incoming))
    startIncoming(win)
    expect(replaceState).toHaveBeenCalledWith({ keep: 1 }, '', '/#top')
    await vi.waitFor(() => {
      expect(got).toHaveLength(1)
    })
    expect(got.map((g) => 'files' in g && g.from)).toEqual(['share'])
    expect(got.flatMap((g) => ('files' in g ? g.files.map((f) => f.name) : []))).toEqual([
      'photo.jpg',
    ])
  })

  it('reports a share with nothing in it', async () => {
    const { storage } = fakeCaches()
    const win = {
      location: { href: `${ORIGIN}/?share=gone` },
      history: { state: null, replaceState: vi.fn() },
      caches: storage,
    } as unknown as Window
    const got: Incoming[] = []
    listenForIncoming((incoming) => got.push(incoming))
    startIncoming(win)
    await vi.waitFor(() => {
      expect(got).toEqual([{ empty: 'share' }])
    })
  })
})
