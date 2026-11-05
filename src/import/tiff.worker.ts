/// <reference lib="webworker" />
/*
 * Decodes TIFF scans (#113) off the main thread; the work is in
 * tiffDecode.ts. Loaded on the first TIFF: this worker and UTIF.js are one
 * small chunk of our own origin.
 */
import { closeTiff, decodeTiffPage, openTiff } from './tiffDecode'
import type { TiffRequest, TiffResponse } from './tiffProtocol'

declare const self: DedicatedWorkerGlobalScope

const post = (message: TiffResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer)
}

self.onmessage = ({ data }: MessageEvent<TiffRequest>) => {
  try {
    const response =
      data.type === 'open'
        ? openTiff(data.bytes)
        : data.type === 'page'
          ? decodeTiffPage(data.index)
          : closeTiff()
    const transfer =
      response.ok && response.type === 'page'
        ? [response.page.kind === 'png' ? response.page.bytes.buffer : response.page.pixels.buffer]
        : []
    post(response, transfer)
  } catch (error) {
    post({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      reason: 'damaged',
    })
  }
}
