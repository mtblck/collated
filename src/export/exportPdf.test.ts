import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asset, page, settings } from '../../tests/helpers'
import type { DocState } from '../core/model'

/** A Worker stand-in: records instances; tests drive its events. */
class FakeWorker {
  static all: FakeWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  posted: unknown[] = []
  constructor() {
    FakeWorker.all.push(this)
  }
  postMessage(message: unknown) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent)
  }
  fail(message = '') {
    this.onerror?.({ message } as ErrorEvent)
  }
}

const doc: DocState = {
  settings: settings(),
  assets: { a: asset('a') },
  pages: [page('p', 'a')],
}
const done = { type: 'done', pdf: new Uint8Array([37]), compression: null, fits: true }

// A fresh module per test: the warm worker is module state.
const load = async () => {
  vi.resetModules()
  const { assetStore } = await import('../import/assetStore')
  assetStore.putBytes('a', new Uint8Array([1, 2, 3]))
  return import('./exportPdf')
}

beforeEach(() => {
  FakeWorker.all = []
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the export worker', () => {
  it('is started ahead of time and used by the first export', async () => {
    const { prepareExport, exportPdf } = await load()
    prepareExport()
    prepareExport() // once is enough
    expect(FakeWorker.all).toHaveLength(1)
    const exported = exportPdf(doc)
    const [worker] = FakeWorker.all
    expect(FakeWorker.all).toHaveLength(1)
    expect(worker?.posted).toHaveLength(1)
    worker?.reply(done)
    await expect(exported).resolves.toMatchObject({ fits: true })
  })

  it('is kept for the next export rather than fetched again', async () => {
    const { prepareExport, exportPdf } = await load()
    prepareExport()
    const first = exportPdf(doc)
    FakeWorker.all[0]?.reply(done)
    await first
    expect(FakeWorker.all[0]?.terminated).toBe(false)
    const second = exportPdf(doc)
    expect(FakeWorker.all).toHaveLength(1)
    FakeWorker.all[0]?.reply(done)
    await expect(second).resolves.toBeDefined()
  })

  it('replaces a worker that failed to load, and says what to do if that fails too', async () => {
    const { prepareExport, exportPdf } = await load()
    prepareExport()
    FakeWorker.all[0]?.fail() // e.g. its file is gone after a deploy
    const exported = exportPdf(doc)
    expect(FakeWorker.all).toHaveLength(2)
    expect(FakeWorker.all[0]?.terminated).toBe(true)
    FakeWorker.all[1]?.fail()
    await expect(exported).rejects.toThrow(/reload the page/)
    // A crashed worker isn't kept.
    expect(FakeWorker.all[1]?.terminated).toBe(true)
  })

  it('reports a build error from the worker as it is', async () => {
    const { exportPdf } = await load()
    const exported = exportPdf(doc)
    FakeWorker.all[0]?.reply({ type: 'error', message: 'Page 1 refers to missing content.' })
    await expect(exported).rejects.toThrow('Page 1 refers to missing content.')
  })

  it('sends drawings for pages that hide a layer, and draws more if the worker asks', async () => {
    const layeredImage = vi.fn((asset: { bytesId: string }, force?: boolean) =>
      Promise.resolve(asset.bytesId === 'f1' || force ? new Uint8Array([0xff, 0xd8]) : null),
    )
    vi.doMock('./layered', () => ({ layeredImage, forgetLayered: vi.fn() }))
    const { exportPdf } = await load()
    const { assetStore } = await import('../import/assetStore')
    assetStore.putBytes('f1', new Uint8Array([9]))
    assetStore.putBytes('f2', new Uint8Array([8]))
    const pdfDoc: DocState = {
      settings: settings(),
      assets: {
        p1: asset('p1', { bytesId: 'f1', format: 'pdf', pdfPage: 0 }),
        p2: asset('p2', { bytesId: 'f2', format: 'pdf', pdfPage: 0 }),
      },
      pages: [page('a', 'p1'), page('b', 'p2')],
    }
    const readDrawn = vi.fn((id: string) => Promise.resolve(id === 'p2' ? { b: ['late'] } : {}))
    const exported = exportPdf(pdfDoc, undefined, {
      text: { a: [] },
      readDrawn: readDrawn as unknown as (
        id: string,
        jpeg: Uint8Array,
      ) => Promise<Record<string, never[]>>,
    })
    await vi.waitFor(() => {
      expect(FakeWorker.all[0]?.posted).toHaveLength(1)
    })
    const first = FakeWorker.all[0]?.posted[0] as {
      input: { rendered?: Record<string, string> }
      bytes: Record<string, Uint8Array>
    }
    // p1's file goes only as its drawing; p2's goes as it is.
    expect(first.input.rendered).toEqual({ p1: 'drawn:p1' })
    expect(Object.keys(first.bytes).sort()).toEqual(['drawn:p1', 'f2'])
    FakeWorker.all[0]?.reply({ type: 'draw', assetIds: ['p2'] })
    await vi.waitFor(() => {
      expect(FakeWorker.all[0]?.posted).toHaveLength(2)
    })
    const second = FakeWorker.all[0]?.posted[1] as typeof first
    expect(layeredImage).toHaveBeenLastCalledWith(expect.objectContaining({ bytesId: 'f2' }), true)
    expect(second.input.rendered).toEqual({ p1: 'drawn:p1', p2: 'drawn:p2' })
    // Words for pages drawn on the second round come from readDrawn.
    expect((second.input as { text?: Record<string, unknown> }).text).toEqual({
      a: [],
      b: ['late'],
    })
    expect(Object.keys(second.bytes).sort()).toEqual(['drawn:p1', 'drawn:p2'])
    FakeWorker.all[0]?.reply(done)
    await expect(exported).resolves.toMatchObject({ fits: true })
    vi.doUnmock('./layered')
  })
})
