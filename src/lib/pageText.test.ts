import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asset } from '../../tests/helpers'
import type * as AssetStore from '../import/assetStore'
import type * as PageText from './pageText'

const recognizeWords = vi.fn(() => Promise.resolve([]))
vi.mock('./ocr', () => ({ recognizeWords }))
vi.mock('./filterCanvas', () => ({
  displayedToBlob: () => Promise.resolve({ blob: new Blob(), width: 1, height: 1 }),
}))

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
    await pageWords(a, upright)
    await pageWords(a, upright)
    expect(recognizeWords).toHaveBeenCalledTimes(1)

    // Another page's miss prunes entries whose bytes are no longer stored.
    assetStore.clear()
    assetStore.putBytes('b', new Uint8Array(1))
    await pageWords(asset('b'), upright)
    assetStore.putBytes('a', new Uint8Array(1))
    await pageWords(a, upright)
    expect(recognizeWords).toHaveBeenCalledTimes(3)
  })

  it('keeps at most 200 entries, dropping the least recently used', async () => {
    const assets = Array.from({ length: 201 }, (_, i) => asset(`p${i}`))
    for (const a of assets) assetStore.putBytes(a.bytesId, new Uint8Array(1))
    const first = assets[0]
    const second = assets[1]
    if (!first || !second) throw new Error('no assets')
    await pageWords(first, upright)
    await pageWords(second, upright)
    for (const a of assets.slice(2, 200)) await pageWords(a, upright)
    await pageWords(first, upright) // a hit: now the most recent
    expect(recognizeWords).toHaveBeenCalledTimes(200)

    const last = assets[200]
    if (!last) throw new Error('no asset')
    await pageWords(last, upright) // the 201st entry evicts the oldest: `second`
    await pageWords(first, upright)
    expect(recognizeWords).toHaveBeenCalledTimes(201)
    await pageWords(second, upright)
    expect(recognizeWords).toHaveBeenCalledTimes(202)
  })
})
