/// <reference lib="webworker" />
import { filterEncoding } from '../core/filters'
import { buildPdf } from '../core/pdf'
import { filterToBlob } from '../lib/filterCanvas'
import type { ExportRequest, ExportResponse } from './protocol'

/*
 * Builds the PDF off the main thread. Embedding passthrough JPEGs is cheap, but
 * PNG scans are decoded and recompressed by pdf-lib, which can take seconds
 * for a batch and would otherwise freeze the page.
 */
declare const self: DedicatedWorkerGlobalScope

const post = (message: ExportResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer)
}

self.onmessage = async ({ data }: MessageEvent<ExportRequest>) => {
  try {
    const pdf = await buildPdf(data.input, {
      getBytes: (id) => {
        const bytes = data.bytes[id]
        if (!bytes) throw new Error(`Missing image data for ${id}.`)
        return bytes
      },
      filterImage: async (bytes, filter) => {
        const blob = await filterToBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), filter)
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          format: filterEncoding(filter).format,
        }
      },
      onProgress: (done, total) => {
        post({ type: 'progress', done, total })
      },
    })
    post({ type: 'done', pdf }, [pdf.buffer])
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
