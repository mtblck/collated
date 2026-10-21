/**
 * Image bytes, kept out of React state: they can be tens of megabytes each and
 * the undo history would otherwise hold references to every version of the
 * state. Entries outlive their pages (undo can bring a page back) and are
 * released together when the document is cleared.
 */
const bytes = new Map<string, Uint8Array>()
const thumbs = new Map<string, string>()

export const assetStore = {
  put(id: string, data: Uint8Array, thumbUrl: string) {
    bytes.set(id, data)
    thumbs.set(id, thumbUrl)
  },
  get(id: string): Uint8Array {
    const data = bytes.get(id)
    if (!data) throw new Error(`Image ${id} is no longer available.`)
    return data
  },
  has(id: string) {
    return bytes.has(id)
  },
  clear() {
    for (const url of thumbs.values()) URL.revokeObjectURL(url)
    bytes.clear()
    thumbs.clear()
  },
}
