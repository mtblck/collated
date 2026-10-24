import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asset } from '../../tests/helpers'
import type * as AssetStore from '../import/assetStore'
import type * as PageText from './pageText'

const recognizeWords = vi.fn(() => Promise.resolve([]))
vi.mock('./ocr', () => ({ recognizeWords }))
const displayedToBlob = vi.fn<
  (source: Blob, corners: unknown) => Promise<{ blob: Blob; width: number; height: number }>
>(() => Promise.resolve({ blob: new Blob(), width: 1, height: 1 }))
vi.mock('./filterCanvas', () => ({ displayedToBlob }))

const upright = { corners: null, turns: 0, angle: 0 } as const

describe('pageWords cache', () => {
  let pageWords: typeof PageText.pageWords
  let assetStore: typeof AssetStore.assetStore

  beforeEach(async () => {
    vi.resetModules()
    recognizeWords.mockClear()
    ;({ pageWords } = await import('./pageText'))
    ;({ assetStore } = await import('../import/assetStore'))
  })

  it('reads a page once, and again after its image is gone', async () => {
    const a = asset('a')
    assetStore.putBytes('a', new Uint8Array(1))
    await pageWords(a, upright, 'eng')
    await pageWords(a, upright, 'eng')
    expect(recognizeWords).toHaveBeenCalledTimes(1)

    // Another page's miss prunes entries whose bytes are no longer stored.
    assetStore.clear()
    assetStore.putBytes('b', new Uint8Array(1))
    await pageWords(asset('b'), upright, 'eng')
    assetStore.putBytes('a', new Uint8Array(1))
    await pageWords(a, upright, 'eng')
    expect(recognizeWords).toHaveBeenCalledTimes(3)
  })

  it('reads a drawn PDF page from its drawing, kept apart from the source', async () => {
    const a = asset('a', { format: 'pdf' })
    assetStore.putBytes('a', new Uint8Array(1))
    const drawn = new Uint8Array([0xff, 0xd8, 9])
    const corners = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ] as const
    displayedToBlob.mockClear()
    await pageWords(a, { ...upright, corners: [...corners] }, 'eng', drawn)
    await pageWords(a, upright, 'eng', drawn)
    expect(recognizeWords).toHaveBeenCalledTimes(1)
    // Read from the drawing's bytes, uncropped.
    const [source, usedCorners] = displayedToBlob.mock.calls[0] ?? [new Blob(), undefined]
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(drawn)
    expect(usedCorners).toBeNull()
    await pageWords(a, upright, 'eng')
    expect(recognizeWords).toHaveBeenCalledTimes(2)
  })

  it('keeps at most 200 entries, dropping the least recently used', async () => {
    const assets = Array.from({ length: 201 }, (_, i) => asset(`p${i}`))
    for (const a of assets) assetStore.putBytes(a.bytesId, new Uint8Array(1))
    const first = assets[0]
    const second = assets[1]
    if (!first || !second) throw new Error('no assets')
    await pageWords(first, upright, 'eng')
    await pageWords(second, upright, 'eng')
    for (const a of assets.slice(2, 200)) await pageWords(a, upright, 'eng')
    await pageWords(first, upright, 'eng') // a hit: now the most recent
    expect(recognizeWords).toHaveBeenCalledTimes(200)

    const last = assets[200]
    if (!last) throw new Error('no asset')
    await pageWords(last, upright, 'eng') // the 201st entry evicts the oldest: `second`
    await pageWords(first, upright, 'eng')
    expect(recognizeWords).toHaveBeenCalledTimes(201)
    await pageWords(second, upright, 'eng')
    expect(recognizeWords).toHaveBeenCalledTimes(202)
  })

  it('reads a page again in another language', async () => {
    const a = asset('a')
    assetStore.putBytes('a', new Uint8Array(1))
    await pageWords(a, upright, 'eng')
    await pageWords(a, upright, 'fra')
    await pageWords(a, upright, 'fra')
    expect(recognizeWords.mock.calls.map((call: unknown[]) => call[3])).toEqual(['eng', 'fra'])
  })
})
