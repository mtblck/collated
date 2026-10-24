import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asset } from '../../tests/helpers'
import { assetStore } from '../import/assetStore'
import { OSD_EDGE } from '../core/orientation'

const detectOrientation = vi.fn(() => Promise.resolve({ degrees: 180, confidence: 20 }))
vi.mock('./ocr', () => ({ detectOrientation }))
const displayedToBlob = vi.fn<(source: Blob, corners: unknown, rotation: number) => unknown>(() =>
  Promise.resolve({ blob: new Blob(), width: 1, height: 1 }),
)
vi.mock('./filterCanvas', () => ({ displayedToBlob }))
const drawn = new Blob(['drawn'])
const renderPdfPage = vi.fn(() => Promise.resolve(drawn))
vi.mock('../import/importPdf', () => ({ renderPdfPage }))

const { pageOrientation } = await import('./orientation')

const corners = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
] as const

describe('pageOrientation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assetStore.putBytes('pdf', new Uint8Array([1, 2]))
    assetStore.putBytes('photo', new Uint8Array([3]))
  })

  it('draws a PDF page from its own page of the file, uncropped', async () => {
    const pdf = asset('p3', { bytesId: 'pdf', format: 'pdf', pdfPage: 2 })
    const result = await pageOrientation(pdf, { corners: [...corners], turns: 1, angle: 0 })
    expect(result).toEqual({ degrees: 180, confidence: 20 })
    expect(renderPdfPage).toHaveBeenCalledWith(new Uint8Array([1, 2]), 2, OSD_EDGE)
    expect(displayedToBlob).toHaveBeenCalledWith(drawn, null, 90, OSD_EDGE)
  })

  it('reads a photo from its bytes, cropped and turned as shown', async () => {
    const photo = asset('photo')
    await pageOrientation(photo, { corners: [...corners], turns: 2, angle: 1.5 })
    expect(renderPdfPage).not.toHaveBeenCalled()
    const [source, usedCorners, rotation] = displayedToBlob.mock.calls[0] ?? [new Blob(), null, 0]
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(new Uint8Array([3]))
    expect(usedCorners).toEqual(corners)
    expect(rotation).toBe(181.5)
  })
})
