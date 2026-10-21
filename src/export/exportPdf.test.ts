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
})
