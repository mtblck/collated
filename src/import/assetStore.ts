/**
 * Imported bytes and thumbnail URLs, kept out of React state: files can be
 * tens of megabytes and the undo history would otherwise hold references to
 * every version of the state. Bytes are keyed by `Asset.bytesId`, so every
 * page of an imported PDF shares one copy. Entries outlive their pages (undo
 * can bring a page back) and are released together when the document is
 * cleared.
 */
const bytes = new Map<string, Uint8Array>()
const thumbs = new Set<string>()

export const assetStore = {
  putBytes(id: string, data: Uint8Array) {
    bytes.set(id, data)
  },
  addThumb(url: string) {
    thumbs.add(url)
  },
  get(id: string): Uint8Array {
    const data = bytes.get(id)
    if (!data) throw new Error(`Content ${id} is no longer available.`)
    return data
  },
  has(id: string) {
    return bytes.has(id)
  },
  clear() {
    for (const url of thumbs) URL.revokeObjectURL(url)
    bytes.clear()
    thumbs.clear()
  },
}
