/**
 * Signatures saved on this device (#111), for signing the next document
 * without drawing again. Local only, in their own IndexedDB database
 * (`collated-signatures`), apart from the kept work: Start over and the
 * Keep work switch leave them, and only deleting one (in the signature
 * picker) takes it away. Never uploaded.
 *
 * Written against a small backend, so it's tested in memory; `idbSignatures`
 * is the real thing.
 */

export interface SavedSignature {
  id: string
  /** A transparent PNG, trimmed to the ink. */
  png: Uint8Array
  width: number
  height: number
  savedAt: number
}

export interface SignatureStore {
  /** Newest first. */
  list(): Promise<SavedSignature[]>
  save(signature: SavedSignature): Promise<void>
  remove(id: string): Promise<void>
}

/** Keeping more than this, the oldest goes: a picker of a dozen is plenty. */
export const SIGNATURES_KEPT = 12

const newestFirst = (all: SavedSignature[]) => all.toSorted((a, b) => b.savedAt - a.savedAt)

/** For tests (and browsers without IndexedDB, where nothing outlives the page). */
export const memorySignatures = (): SignatureStore => {
  const kept = new Map<string, SavedSignature>()
  return {
    list: () => Promise.resolve(newestFirst([...kept.values()])),
    save: (signature) => {
      kept.set(signature.id, signature)
      for (const old of newestFirst([...kept.values()]).slice(SIGNATURES_KEPT)) {
        kept.delete(old.id)
      }
      return Promise.resolve()
    },
    remove: (id) => {
      kept.delete(id)
      return Promise.resolve()
    },
  }
}

const DB_NAME = 'collated-signatures'
const STORE = 'signatures'

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
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
    tx.onabort = tx.onerror = () => {
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
  })

const isSignature = (value: unknown): value is SavedSignature => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<SavedSignature>
  return (
    typeof v.id === 'string' &&
    v.png instanceof Uint8Array &&
    typeof v.width === 'number' &&
    typeof v.height === 'number' &&
    typeof v.savedAt === 'number'
  )
}

export const idbSignatures = (idb: IDBFactory): SignatureStore => {
  let opened: Promise<IDBDatabase> | null = null
  const db = () => {
    opened ??= new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' })
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
  const list = async () => {
    const tx = (await db()).transaction(STORE, 'readonly')
    const all: unknown[] = await done(tx.objectStore(STORE).getAll())
    return newestFirst(all.filter(isSignature))
  }
  return {
    list,
    save: async (signature) => {
      const old = (await list()).slice(SIGNATURES_KEPT - 1)
      const tx = (await db()).transaction(STORE, 'readwrite')
      const end = finished(tx)
      const store = tx.objectStore(STORE)
      store.put(signature)
      for (const { id } of old) if (id !== signature.id) store.delete(id)
      await end
    },
    remove: async (id) => {
      const tx = (await db()).transaction(STORE, 'readwrite')
      const end = finished(tx)
      tx.objectStore(STORE).delete(id)
      await end
    },
  }
}

let device: SignatureStore | null = null

/** The signatures on this device: IndexedDB, or (without it) this page only. */
export const deviceSignatures = (): SignatureStore => {
  if (device) return device
  try {
    device = typeof indexedDB === 'undefined' ? memorySignatures() : idbSignatures(indexedDB)
  } catch {
    device = memorySignatures()
  }
  return device
}
