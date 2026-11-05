import { describe, expect, it } from 'vitest'
import { SIGNATURES_KEPT, memorySignatures, type SavedSignature } from './signatureStore'

const saved = (id: string, savedAt: number): SavedSignature => ({
  id,
  png: new Uint8Array([1, 2, 3]),
  width: 30,
  height: 10,
  savedAt,
})

describe('signatures saved on this device (#111)', () => {
  it('lists newest first, keeps a dozen, and deletes on request', async () => {
    const store = memorySignatures()
    for (let i = 0; i < SIGNATURES_KEPT + 2; i++) await store.save(saved(`s${String(i)}`, i))
    const all = await store.list()
    expect(all).toHaveLength(SIGNATURES_KEPT)
    expect(all[0]?.id).toBe(`s${String(SIGNATURES_KEPT + 1)}`)
    expect(all.some((s) => s.id === 's0' || s.id === 's1')).toBe(false)
    await store.remove(all[0]?.id ?? '')
    expect(await store.list()).toHaveLength(SIGNATURES_KEPT - 1)
  })
})
