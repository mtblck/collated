/// <reference lib="webworker" />
/*
 * Looks for a sheet of paper in a page's thumbnail (core/paper.ts), off the
 * main thread: decoding and the edge search take tens of milliseconds a page,
 * which adds up over "Auto-crop all pages".
 */
import { findPaper } from '../core/paper'
import type { PaperRequest, PaperResponse } from './paperProtocol'

declare const self: DedicatedWorkerGlobalScope

const post = (message: PaperResponse) => {
  self.postMessage(message)
}

self.onmessage = async ({ data }: MessageEvent<PaperRequest>) => {
  try {
    const bitmap = await createImageBitmap(data.thumb)
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('No 2D canvas in this worker.')
      ctx.drawImage(bitmap, 0, 0)
      const { data: rgba } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      post({ id: data.id, ok: true, guess: findPaper(rgba, bitmap.width, bitmap.height) })
    } finally {
      bitmap.close()
    }
  } catch (error) {
    post({
      id: data.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
