import { afterEach, describe, expect, it, vi } from 'vitest'

describe('layeredImage cache', () => {
  afterEach(() => {
    vi.doUnmock('../import/importPdf')
    vi.doUnmock('../import/assetStore')
    vi.resetModules()
  })

  it('forgetForced drops the forced drawings (PDF/A, #116) and keeps the rest', async () => {
    const layeredPage = vi.fn(() => Promise.resolve({ hidden: true, jpeg: new Uint8Array([1]) }))
    vi.doMock('../import/importPdf', () => ({ layeredPage }))
    vi.doMock('../import/assetStore', () => ({ assetStore: { get: () => new Uint8Array() } }))
    const { forgetForced, layeredImage } = await import('./layered')
    const page = { bytesId: 'f', pdfPage: 0 }
    await layeredImage(page, true)
    await layeredImage(page)
    expect(layeredPage).toHaveBeenCalledTimes(2)
    forgetForced()
    await layeredImage(page)
    expect(layeredPage).toHaveBeenCalledTimes(2)
    await layeredImage(page, true)
    expect(layeredPage).toHaveBeenCalledTimes(3)
  })
})
