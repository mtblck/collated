import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asset, settings } from '../../tests/helpers'
import { initHistory, withHistory, type History } from '../core/history'
import type { DocState } from '../core/model'
import { docReducer } from '../core/reducer'
import { assetStore } from '../import/assetStore'
import { createWorkStore, memoryBackend, reachableAssets } from './workStore'

const reduce = withHistory(docReducer)

/** A document of `ids`, one image each, its bytes and thumbnails in the asset store. */
const docOf = (...ids: string[]): History<DocState> => {
  const assets = ids.map((id) => {
    assetStore.putBytes(id, new Uint8Array(100).fill(id.charCodeAt(0)))
    return asset(id, { thumbUrl: assetStore.thumbUrl(new Blob([id], { type: 'image/jpeg' })) })
  })
  return reduce(initHistory<DocState>({ settings: settings(), assets: {}, pages: [] }), {
    type: 'do',
    action: { type: 'addPages', assets, pageIds: ids.map((id) => `p-${id}`) },
  })
}

let urls = 0
beforeEach(() => {
  urls = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++urls}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})
afterEach(() => {
  assetStore.clear()
  vi.restoreAllMocks()
})

describe('work store (#74)', () => {
  it('finds every asset the undo history can reach', () => {
    let h = docOf('a', 'b')
    h = reduce(h, { type: 'do', action: { type: 'removePage', id: 'p-a' } })
    expect([...reachableAssets(h).keys()].sort()).toEqual(['a', 'b'])
  })

  it('keeps every picture of a combined page (#76)', () => {
    let h = docOf('a', 'b', 'c')
    h = reduce(h, {
      type: 'do',
      action: { type: 'combinePages', ids: ['p-a', 'p-b'], kind: 'two', newIds: ['s'] },
    })
    h = reduce(h, { type: 'do', action: { type: 'removePage', id: 'p-c' } })
    // Undo history aside, the combined page alone needs a and b.
    const present = { past: [], present: h.present, future: [], lastKey: null }
    expect([...reachableAssets(present).keys()].sort()).toEqual(['a', 'b'])
  })

  it('round-trips the history, undo included, with fresh thumbnail URLs', async () => {
    const backend = memoryBackend()
    const store = createWorkStore(backend, () => 1234)
    let h = docOf('a', 'b')
    h = reduce(h, { type: 'do', action: { type: 'removePage', id: 'p-a' } })
    expect(await store.save(h, 'p-b')).toBe('saved')
    expect(await store.peek()).toEqual({ savedAt: 1234, pages: 1 })

    assetStore.clear() // a reload: nothing in memory
    const restored = await createWorkStore(backend).restore()
    expect(restored?.selectedId).toBe('p-b')
    expect(restored?.history.present.pages.map((p) => p.id)).toEqual(['p-b'])
    // Undo brings the removed page back, bytes and all.
    expect(restored?.history.past.at(-1)?.pages.map((p) => p.id)).toEqual(['p-a', 'p-b'])
    expect(assetStore.get('a')[0]).toBe('a'.charCodeAt(0))
    const thumb = restored?.history.present.assets.b?.thumbUrl ?? ''
    expect(Number(thumb.slice(5))).toBeGreaterThan(2) // made after the reload
    expect(await assetStore.thumbBlob(thumb)?.text()).toBe('b')
  })

  it('writes each file’s bytes once, and drops them when nothing can reach them', async () => {
    const backend = memoryBackend()
    const store = createWorkStore(backend)
    const put = vi.spyOn(backend, 'write')
    let h = docOf('a')
    await store.save(h, null)
    h = reduce(h, { type: 'do', action: { type: 'transformPage', id: 'p-a', patch: { angle: 2 } } })
    await store.save(h, null)
    expect(put.mock.calls.map(([c]) => c.putBytes.length)).toEqual([1, 0])
    // A PDF's pages share one copy of its bytes.
    const pdf = [0, 1].map((i) =>
      asset(`pdf${i}`, { bytesId: 'pdf', format: 'pdf', pdfPage: i, thumbUrl: '' }),
    )
    assetStore.putBytes('pdf', new Uint8Array(10))
    h = reduce(initHistory(h.present), {
      type: 'do',
      action: { type: 'addPages', assets: pdf, pageIds: ['q0', 'q1'] },
    })
    h = reduce(initHistory(h.present), {
      type: 'do',
      action: { type: 'removePage', id: 'p-a' },
    })
    await store.save(initHistory(h.present), null)
    expect([...backend.bytes.keys()]).toEqual(['pdf'])
    expect([...backend.thumbs.keys()]).toEqual([])
  })

  it('reports a quota failure and keeps no partial copy', async () => {
    const backend = memoryBackend({ quotaBytes: 150 })
    const store = createWorkStore(backend)
    expect(await store.save(docOf('a'), null)).toBe('saved')
    expect(await store.save(docOf('a', 'b'), null)).toBe('too-big')
    expect(await store.peek()).toBeNull()
    expect(backend.bytes.size).toBe(0)
  })

  it('clears instead of saving an empty document, and Start over’s clear wins over an earlier save', async () => {
    const backend = memoryBackend()
    const store = createWorkStore(backend)
    const h = docOf('a')
    const saved = store.save(h, null)
    const cleared = store.clear()
    await Promise.all([saved, cleared])
    expect(await store.peek()).toBeNull()
    await store.save(h, null)
    const emptied = reduce(initHistory(h.present), {
      type: 'do',
      action: { type: 'removePage', id: 'p-a' },
    })
    expect(await store.save(emptied, null)).toBe('cleared')
    expect(backend.bytes.size).toBe(0)
  })

  it('offers nothing when a stored file is missing', async () => {
    const backend = memoryBackend()
    const store = createWorkStore(backend)
    await store.save(docOf('a'), null)
    backend.bytes.clear()
    expect(await createWorkStore(backend).restore()).toBeNull()
  })

  it('never stores the password: it isn’t part of the document', async () => {
    const backend = memoryBackend()
    await createWorkStore(backend).save(docOf('a'), null)
    expect(JSON.stringify(await backend.getDoc())).not.toMatch(/password/i)
  })
})
