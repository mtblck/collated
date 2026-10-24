import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Ocr from './ocr'

interface FakeTesseract {
  recognize: ReturnType<typeof vi.fn>
  detect?: ReturnType<typeof vi.fn>
  setParameters?: ReturnType<typeof vi.fn>
  terminate: ReturnType<typeof vi.fn>
}

const createWorker = vi.fn<(...args: unknown[]) => Promise<FakeTesseract>>()
vi.mock('tesseract.js', () => ({ createWorker, OEM: { TESSERACT_ONLY: 0, LSTM_ONLY: 1 } }))

const fakeWorker = (recognize: () => Promise<unknown>): FakeTesseract => ({
  recognize: vi.fn(recognize),
  terminate: vi.fn(() => Promise.resolve()),
})
const empty = () => Promise.resolve({ data: { blocks: [] } })
const image = new Blob()

describe('recognizeWords worker lifecycle', () => {
  let ocr: typeof Ocr

  beforeEach(async () => {
    vi.resetModules()
    createWorker.mockReset()
    ocr = await import('./ocr')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps one worker across pages', async () => {
    createWorker.mockResolvedValue(fakeWorker(empty))
    await ocr.recognizeWords(image, 10, 10, 'eng')
    await ocr.recognizeWords(image, 10, 10, 'eng')
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('doesn’t cache a worker that failed to start', async () => {
    createWorker.mockRejectedValueOnce(new Error('network'))
    createWorker.mockResolvedValueOnce(fakeWorker(empty))
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).rejects.toThrow('couldn’t start')
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).resolves.toEqual([])
    expect(createWorker).toHaveBeenCalledTimes(2)
  })

  it('times out a worker that never starts', async () => {
    vi.useFakeTimers()
    createWorker.mockReturnValueOnce(new Promise(() => undefined))
    const stuck = expect(ocr.recognizeWords(image, 10, 10, 'eng')).rejects.toThrow(
      'too long to start',
    )
    await vi.advanceTimersByTimeAsync(ocr.OCR_START_TIMEOUT_MS)
    await stuck
    createWorker.mockResolvedValueOnce(fakeWorker(empty))
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).resolves.toEqual([])
  })

  it('terminates a stalled page and starts fresh next time', async () => {
    vi.useFakeTimers()
    const stalled = fakeWorker(() => new Promise(() => undefined))
    createWorker.mockResolvedValueOnce(stalled)
    const page = expect(ocr.recognizeWords(image, 10, 10, 'eng')).rejects.toThrow('took too long')
    await vi.advanceTimersByTimeAsync(ocr.OCR_PAGE_TIMEOUT_MS)
    await page
    expect(stalled.terminate).toHaveBeenCalled()

    const fresh = fakeWorker(empty)
    createWorker.mockResolvedValueOnce(fresh)
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).resolves.toEqual([])
    expect(fresh.recognize).toHaveBeenCalledTimes(1)
  })

  it('starts the chosen language, and replaces the worker when it changes', async () => {
    const english = fakeWorker(empty)
    createWorker.mockResolvedValueOnce(english)
    await ocr.recognizeWords(image, 10, 10, 'eng')
    const french = fakeWorker(empty)
    createWorker.mockResolvedValueOnce(french)
    await ocr.recognizeWords(image, 10, 10, 'fra')
    await ocr.recognizeWords(image, 10, 10, 'fra')
    expect(createWorker.mock.calls.map(([language]) => language)).toEqual(['eng', 'fra'])
    expect(createWorker).toHaveBeenLastCalledWith(
      'fra',
      1,
      expect.objectContaining({ langPath: expect.stringMatching(/\/ocr\/lang$/) as unknown }),
    )
    expect(english.terminate).toHaveBeenCalled()
    expect(french.terminate).not.toHaveBeenCalled()
    expect(french.recognize).toHaveBeenCalledTimes(2)
  })

  it('replaces a worker whose recognise failed', async () => {
    const failing = fakeWorker(() => Promise.reject(new Error('engine crashed')))
    createWorker.mockResolvedValueOnce(failing)
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).rejects.toThrow('engine crashed')
    expect(failing.terminate).toHaveBeenCalled()
    createWorker.mockResolvedValueOnce(fakeWorker(empty))
    await expect(ocr.recognizeWords(image, 10, 10, 'eng')).resolves.toEqual([])
  })
})

describe('recognizeWords', () => {
  it('keeps unlisted words whose every letter it’s sure of, drops noise', async () => {
    vi.resetModules()
    createWorker.mockReset()
    const ocr = await import('./ocr')
    const box = { x0: 0, y0: 0, x1: 5, y1: 5 }
    const word = (text: string, confidence: number, symbols: number[]) => ({
      text,
      confidence,
      bbox: box,
      symbols: symbols.map((c) => ({ text: 'x', confidence: c })),
    })
    const lines = [
      {
        baseline: { x0: 0, y0: 5, x1: 10, y1: 5 },
        words: [
          word('élève', 96, [99, 98, 99, 99, 99]),
          // Measured from tesseract's French data on a typeset page.
          word('l’élève', 36, [99, 94, 98, 99, 99, 99, 99]),
          word('~|', 30, [40, 85]),
          word('?', 20, []),
        ],
      },
    ]
    createWorker.mockResolvedValueOnce(
      fakeWorker(() => Promise.resolve({ data: { blocks: [{ paragraphs: [{ lines }] }] } })),
    )
    const words = await ocr.recognizeWords(image, 10, 10, 'fra')
    expect(words.map((w) => w.text)).toEqual(['élève', 'l’élève'])
  })
})

describe('detectOrientation', () => {
  let ocr: typeof Ocr

  beforeEach(async () => {
    vi.resetModules()
    createWorker.mockReset()
    ocr = await import('./ocr')
  })

  const orienter = (data: Record<string, number | null>) => ({
    ...fakeWorker(empty),
    detect: vi.fn(() => Promise.resolve({ data })),
    setParameters: vi.fn(() => Promise.resolve()),
  })

  it('starts the legacy engine with the orientation data, apart from OCR', async () => {
    createWorker.mockResolvedValueOnce(
      orienter({ orientation_degrees: 90, orientation_confidence: 8 }),
    )
    await expect(ocr.detectOrientation(image)).resolves.toEqual({ degrees: 90, confidence: 8 })
    expect(createWorker).toHaveBeenCalledWith(
      'osd',
      0,
      expect.objectContaining({ legacyCore: true, legacyLang: true, workerBlobURL: false }),
    )
    // Searchable text still gets its own LSTM-only worker.
    createWorker.mockResolvedValueOnce(fakeWorker(empty))
    await ocr.recognizeWords(image, 10, 10, 'eng')
    expect(createWorker).toHaveBeenLastCalledWith('eng', 1, expect.anything())
  })

  it('says nothing when there was too little text', async () => {
    createWorker.mockResolvedValueOnce(
      orienter({ orientation_degrees: null, orientation_confidence: null }),
    )
    await expect(ocr.detectOrientation(image)).resolves.toBeNull()
  })

  it('names orientation, not OCR, when it can’t start', async () => {
    createWorker.mockRejectedValueOnce(new Error('network'))
    await expect(ocr.detectOrientation(image)).rejects.toThrow(
      'Finding which way up the pages are couldn’t start',
    )
  })
})
