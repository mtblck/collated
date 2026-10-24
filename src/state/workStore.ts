import type { History } from '../core/history'
import { picturesOf, type Asset, type DocState, type Settings } from '../core/model'
import { NO_WATERMARK } from '../core/watermark'
import { assetStore } from '../import/assetStore'

/**
 * Keeps the document on this device (#74), so a reload, a crashed tab or a
 * phone dropping the page in the background doesn't lose it. Local only, in
 * IndexedDB: the undo history (metadata), each imported file's bytes once per
 * `bytesId`, and each asset's thumbnail. Never the password (it isn't in the
 * document). Start over and the Keep work setting clear it.
 *
 * The logic is written against a small `WorkBackend`, so it is tested with an
 * in-memory one; `idbBackend` is the real thing.
 */

/** What is kept of the document itself. Thumbnail URLs are per page load, so they're blanked. */
export interface StoredDoc {
  version: 1
  savedAt: number
  history: History<DocState>
  selectedId: string | null
}

export interface WorkChange {
  doc: StoredDoc
  putBytes: [string, Uint8Array][]
  putThumbs: [string, Blob][]
  deleteBytes: string[]
  deleteThumbs: string[]
}

export interface WorkBackend {
  getDoc(): Promise<StoredDoc | undefined>
  keys(): Promise<{ bytes: string[]; thumbs: string[] }>
  getBytes(id: string): Promise<Uint8Array | undefined>
  getThumb(id: string): Promise<Blob | undefined>
  /** All or nothing: a failed write (quota) leaves what was there. */
  write(change: WorkChange): Promise<void>
  clear(): Promise<void>
}

export interface SavedSummary {
  savedAt: number
  pages: number
}

export type SaveResult = 'saved' | 'cleared' | 'too-big' | 'failed'

export interface WorkStore {
  /** The last document, if there is one worth offering. */
  peek(): Promise<SavedSummary | null>
  /**
   * Loads the last document's bytes and thumbnails into `assetStore` and
   * returns its history, with fresh thumbnail URLs; null if nothing usable.
   */
  restore(): Promise<Pick<StoredDoc, 'history' | 'selectedId'> | null>
  /** Writes what changed since the last save; an empty document clears instead. */
  save(history: History<DocState>, selectedId: string | null): Promise<SaveResult>
  clear(): Promise<void>
}

const statesOf = (history: History<DocState>) => [
  ...history.past,
  history.present,
  ...history.future,
]

/**
 * Every asset a page in any state of the history uses, by id: undo may need
 * any of them. (The reducer keeps assets after their pages go; one no state
 * shows is never needed again.)
 */
export const reachableAssets = (history: History<DocState>): Map<string, Asset> => {
  const assets = new Map<string, Asset>()
  for (const state of statesOf(history)) {
    // A combined page (#76) needs every picture on it, not just the first.
    for (const { assetId } of state.pages.flatMap((p) => picturesOf(p))) {
      const asset = state.assets[assetId]
      if (asset) assets.set(asset.id, asset)
    }
  }
  return assets
}

const mapAssets = (
  history: History<DocState>,
  thumbUrl: (asset: Asset) => string,
): History<DocState> => {
  const mapState = (state: DocState): DocState => {
    // Settings added since the work was saved start at their defaults; OCR
    // read only English before #79.
    const saved: Partial<Settings> = state.settings
    return {
      ...state,
      settings: {
        ...state.settings,
        bookmarkFiles: saved.bookmarkFiles ?? false,
        ocrLanguage: saved.ocrLanguage ?? 'eng',
        watermark: saved.watermark ?? NO_WATERMARK,
      },
      assets: Object.fromEntries(
        Object.entries(state.assets).map(([id, a]) => [id, { ...a, thumbUrl: thumbUrl(a) }]),
      ),
    }
  }
  return {
    past: history.past.map(mapState),
    present: mapState(history.present),
    future: history.future.map(mapState),
    lastKey: null,
  }
}

const isQuota = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')

export const createWorkStore = (backend: WorkBackend, now = () => Date.now()): WorkStore => {
  // What the backend holds, as far as this page knows; read once, then kept
  // in step with each write, so bytes are written once per asset.
  let known: Promise<{ bytes: Set<string>; thumbs: Set<string> }> | null = null
  const stored = () => {
    known ??= backend.keys().then(
      ({ bytes, thumbs }) => ({ bytes: new Set(bytes), thumbs: new Set(thumbs) }),
      () => ({ bytes: new Set<string>(), thumbs: new Set<string>() }),
    )
    return known
  }
  // One at a time, in order: a save mustn't land after the clear that followed it.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }
  const clear = async () => {
    known = Promise.resolve({ bytes: new Set(), thumbs: new Set() })
    await backend.clear()
  }

  return {
    peek: async () => {
      try {
        const doc = await backend.getDoc()
        if (doc?.version !== 1 || doc.history.present.pages.length === 0) return null
        return { savedAt: doc.savedAt, pages: doc.history.present.pages.length }
      } catch {
        return null
      }
    },

    restore: () =>
      serial(async () => {
        try {
          const doc = await backend.getDoc()
          if (doc?.version !== 1) return null
          const assets = reachableAssets(doc.history)
          const bytes = new Map<string, Uint8Array>()
          for (const { bytesId } of assets.values()) {
            if (bytes.has(bytesId)) continue
            const data = await backend.getBytes(bytesId)
            // Without its bytes a page can't be shown or exported: the copy is
            // incomplete, so it isn't offered at all.
            if (!data) return null
            bytes.set(bytesId, data)
          }
          for (const [id, data] of bytes) assetStore.putBytes(id, data)
          const urls = new Map<string, string>()
          for (const id of assets.keys()) {
            const blob = await backend.getThumb(id)
            if (blob) urls.set(id, assetStore.thumbUrl(blob))
          }
          return {
            history: mapAssets(doc.history, (a) => urls.get(a.id) ?? ''),
            selectedId: doc.selectedId,
          }
        } catch {
          return null
        }
      }),

    save: (history, selectedId) =>
      serial(async () => {
        try {
          if (history.present.pages.length === 0) {
            await clear()
            return 'cleared'
          }
          const have = await stored()
          const assets = reachableAssets(history)
          const bytesIds = new Set([...assets.values()].map((a) => a.bytesId))
          const change: WorkChange = {
            doc: {
              version: 1,
              savedAt: now(),
              history: mapAssets(history, () => ''),
              selectedId,
            },
            putBytes: [...bytesIds]
              .filter((id) => !have.bytes.has(id) && assetStore.has(id))
              .map((id) => [id, assetStore.get(id)]),
            putThumbs: [...assets.values()].flatMap((a): [string, Blob][] => {
              if (have.thumbs.has(a.id)) return []
              const blob = assetStore.thumbBlob(a.thumbUrl)
              return blob ? [[a.id, blob]] : []
            }),
            deleteBytes: [...have.bytes].filter((id) => !bytesIds.has(id)),
            deleteThumbs: [...have.thumbs].filter((id) => !assets.has(id)),
          }
          await backend.write(change)
          for (const [id] of change.putBytes) have.bytes.add(id)
          for (const [id] of change.putThumbs) have.thumbs.add(id)
          for (const id of change.deleteBytes) have.bytes.delete(id)
          for (const id of change.deleteThumbs) have.thumbs.delete(id)
          return 'saved'
        } catch (error) {
          // Too big for what the browser allows this site: drop the partial
          // copy, so an old version isn't offered later as if it were current.
          await clear().catch(() => undefined)
          return isQuota(error) ? 'too-big' : 'failed'
        }
      }),

    clear: () => serial(clear),
  }
}

/** For tests (and browsers without IndexedDB): the same behaviour, in memory. */
export const memoryBackend = (options: { quotaBytes?: number } = {}) => {
  let doc: StoredDoc | undefined
  const bytes = new Map<string, Uint8Array>()
  const thumbs = new Map<string, Blob>()
  const backend: WorkBackend & { bytes: typeof bytes; thumbs: typeof thumbs; writes: number } = {
    bytes,
    thumbs,
    writes: 0,
    getDoc: () => Promise.resolve(doc && structuredClone(doc)),
    keys: () => Promise.resolve({ bytes: [...bytes.keys()], thumbs: [...thumbs.keys()] }),
    getBytes: (id) => Promise.resolve(bytes.get(id)),
    getThumb: (id) => Promise.resolve(thumbs.get(id)),
    write: (change) => {
      const after = new Map(bytes)
      for (const [id, data] of change.putBytes) after.set(id, data)
      for (const id of change.deleteBytes) after.delete(id)
      const total = [...after.values()].reduce((sum, d) => sum + d.byteLength, 0)
      if (options.quotaBytes !== undefined && total > options.quotaBytes) {
        return Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))
      }
      backend.writes += 1
      bytes.clear()
      for (const [id, data] of after) bytes.set(id, data)
      for (const [id, blob] of change.putThumbs) thumbs.set(id, blob)
      for (const id of change.deleteThumbs) thumbs.delete(id)
      doc = structuredClone(change.doc)
      return Promise.resolve()
    },
    clear: () => {
      doc = undefined
      bytes.clear()
      thumbs.clear()
      return Promise.resolve()
    },
  }
  return backend
}

const DB_NAME = 'collated-work'
const STORES = ['doc', 'bytes', 'thumbs'] as const

const done = (request: IDBRequest) =>
  new Promise<unknown>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result)
    }
    request.onerror = () => {
      reject(request.error ?? new Error('IndexedDB request failed'))
    }
  })

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      resolve()
    }
    // A quota failure aborts the transaction; its error says why.
    tx.onabort = tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
  })

/** The document in IndexedDB on this device: one database, three object stores. */
export const idbBackend = (idb: IDBFactory): WorkBackend => {
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name)
          }
        }
      }
      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => {
        opened = null
        reject(request.error ?? new Error('IndexedDB is unavailable'))
      }
    })
    return opened
  }
  const get = async <T>(store: (typeof STORES)[number], key: string) => {
    const tx = (await db()).transaction(store, 'readonly')
    return (await done(tx.objectStore(store).get(key))) as T | undefined
  }
  return {
    getDoc: () => get<StoredDoc>('doc', 'current'),
    getBytes: (id) => get<Uint8Array>('bytes', id),
    getThumb: (id) => get<Blob>('thumbs', id),
    keys: async () => {
      const tx = (await db()).transaction(['bytes', 'thumbs'], 'readonly')
      const [bytes, thumbs] = await Promise.all([
        done(tx.objectStore('bytes').getAllKeys()),
        done(tx.objectStore('thumbs').getAllKeys()),
      ])
      return { bytes: (bytes as string[]).map(String), thumbs: (thumbs as string[]).map(String) }
    },
    write: async (change) => {
      const tx = (await db()).transaction([...STORES], 'readwrite')
      const end = finished(tx)
      const bytes = tx.objectStore('bytes')
      const thumbs = tx.objectStore('thumbs')
      for (const [id, data] of change.putBytes) bytes.put(data, id)
      for (const [id, blob] of change.putThumbs) thumbs.put(blob, id)
      for (const id of change.deleteBytes) bytes.delete(id)
      for (const id of change.deleteThumbs) thumbs.delete(id)
      tx.objectStore('doc').put(change.doc, 'current')
      await end
    },
    clear: async () => {
      const tx = (await db()).transaction([...STORES], 'readwrite')
      const end = finished(tx)
      for (const name of STORES) tx.objectStore(name).clear()
      await end
    },
  }
}

/** Nothing kept: for when IndexedDB isn't there (some private modes). */
const noWork: WorkStore = {
  peek: () => Promise.resolve(null),
  restore: () => Promise.resolve(null),
  save: () => Promise.resolve('failed'),
  clear: () => Promise.resolve(),
}

export const deviceWorkStore = (): WorkStore => {
  try {
    return typeof indexedDB === 'undefined' ? noWork : createWorkStore(idbBackend(indexedDB))
  } catch {
    return noWork
  }
}
