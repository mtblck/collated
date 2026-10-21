import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DecodeHeic from './decodeHeic'
import type { HeicResponse } from './heicProtocol'

/** A stand-in for the HEIC worker that the test answers by hand. */
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((event: { data: HeicResponse }) => void) | null = null
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null
  terminated = false
  posted = 0
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage() {
    this.posted += 1
  }
  terminate() {
    this.terminated = true
  }
  reply(data: HeicResponse) {
    this.onmessage?.({ data })
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

const file = () => new Blob([new Uint8Array(16)])
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('decodeHeic', () => {
  let decodeHeic: typeof DecodeHeic.decodeHeic
  let HEIC_TIMEOUT_MS: number
  const bitmaps: unknown[] = []

  beforeEach(async () => {
    vi.resetModules()
    FakeWorker.all = []
    bitmaps.length = 0
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('ImageData', FakeImageData)
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((image: unknown) => {
        bitmaps.push(image)
        return Promise.resolve({ close: vi.fn() })
      }),
    )
    ;({ decodeHeic, HEIC_TIMEOUT_MS } = await import('./decodeHeic'))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('uses the transferred pixels as they are and keeps one worker', async () => {
    const pixels = new Uint8ClampedArray(2 * 1 * 4)
    const first = decodeHeic(file())
    await flush()
    FakeWorker.all[0]?.reply({ ok: true, width: 2, height: 1, pixels })
    await first
    expect((bitmaps[0] as FakeImageData).data).toBe(pixels)

    const second = decodeHeic(file())
    await flush()
    FakeWorker.all[0]?.reply({ ok: true, width: 2, height: 1, pixels: new Uint8ClampedArray(8) })
    await second
    expect(FakeWorker.all).toHaveLength(1)
  })

  it('reports an oversized photo as an ImportError naming its size', async () => {
    const result = decodeHeic(file())
    await flush()
    FakeWorker.all[0]?.reply({
      ok: false,
      message: 'too big',
      tooLarge: { width: 20_000, height: 20_000 },
    })
    await expect(result).rejects.toMatchObject({
      name: 'ImportError',
      message: expect.stringContaining('20,000 × 20,000') as unknown,
    })
  })

  it('stops a stuck decode, so the next file gets a fresh worker', async () => {
    vi.useFakeTimers()
    const stuck = decodeHeic(file())
    const next = decodeHeic(file())
    await vi.advanceTimersByTimeAsync(0)
    const first = FakeWorker.all[0]
    expect(first?.posted).toBe(1)
    const failed = expect(stuck).rejects.toMatchObject({
      name: 'ImportError',
      message: expect.stringContaining('took too long') as unknown,
    })
    await vi.advanceTimersByTimeAsync(HEIC_TIMEOUT_MS)
    await failed
    expect(first?.terminated).toBe(true)

    // The queued file wasn't stalled behind it, and runs in a new worker.
    expect(FakeWorker.all).toHaveLength(2)
    FakeWorker.all[1]?.reply({ ok: true, width: 1, height: 1, pixels: new Uint8ClampedArray(4) })
    await expect(next).resolves.toBeDefined()
  })

  it('replaces a worker that failed to start', async () => {
    const broken = decodeHeic(file())
    await flush()
    FakeWorker.all[0]?.onerror?.({ message: 'boom', preventDefault: vi.fn() })
    await expect(broken).rejects.toThrow('boom')
    expect(FakeWorker.all[0]?.terminated).toBe(true)

    const retry = decodeHeic(file())
    await flush()
    expect(FakeWorker.all).toHaveLength(2)
    FakeWorker.all[1]?.reply({ ok: true, width: 1, height: 1, pixels: new Uint8ClampedArray(4) })
    await expect(retry).resolves.toBeDefined()
  })
})
