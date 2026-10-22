/**
 * Imported bytes and thumbnail URLs, kept out of React state: files can be
 * tens of megabytes and the undo history would otherwise hold references to
 * every version of the state. Bytes are keyed by `Asset.bytesId`, so every
 * page of an imported PDF shares one copy. Entries outlive their pages, so
 * undo can bring a removed page back, so nothing is released while the
 * document can still reach it (even the reducer's `clear` action is undoable,
 * so it keeps the bytes too). `clear()` frees everything, for Start over,
 * which drops the undo history with it; so does reloading the page.
 */
const bytes = new Map<string, Uint8Array>()
/** Thumbnail object URLs and their blobs (filters read the blob back). */
const thumbs = new Map<string, Blob>()

export const assetStore = {
  putBytes(id: string, data: Uint8Array) {
    bytes.set(id, data)
  },
  /**
   * Makes an object URL for a thumbnail and keeps its blob, so the URL can be
   * revoked on clear and the pixels read again without fetch() — which the
   * CSP's connect-src would refuse for blob: URLs.
   */
  thumbUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    thumbs.set(url, blob)
    return url
  },
  thumbBlob(url: string): Blob | undefined {
    return thumbs.get(url)
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
    for (const url of thumbs.keys()) URL.revokeObjectURL(url)
    bytes.clear()
    thumbs.clear()
  },
}
