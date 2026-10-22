/// <reference lib="webworker" />
import { buildWithin, compressionFor } from '../core/compression'
import { buildPdf } from '../core/pdf'
import { NeedsDrawing } from '../core/pdfSanitize'
import { processToBlob } from '../lib/filterCanvas'
import type { ExportRequest, ExportResponse } from './protocol'

/*
 * Builds the PDF off the main thread. Embedding passthrough JPEGs is cheap,
 * but filtering, resizing and PNG recompression can take seconds for a batch
 * and would otherwise freeze the page.
 */
declare const self: DedicatedWorkerGlobalScope

const post = (message: ExportResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer)
}

self.onmessage = async ({ data }: MessageEvent<ExportRequest>) => {
  try {
    const { settings } = data.input
    let attempt = 1
    const result = await buildWithin(
      (compression) =>
        buildPdf(
          { ...data.input, compression },
          {
            getBytes: (id) => {
              const bytes = data.bytes[id]
              if (!bytes) throw new Error(`Missing image data for ${id}.`)
              return bytes
            },
            processImage: async (bytes, job) => {
              const blob = await processToBlob(new Blob([bytes as Uint8Array<ArrayBuffer>]), job)
              return new Uint8Array(await blob.arrayBuffer())
            },
            onProgress: (done, total) => {
              post({ type: 'progress', done, total, attempt })
            },
          },
        ),
      compressionFor(settings.quality),
      settings.maxBytes,
      (n) => {
        attempt = n
      },
    )
    post({ type: 'done', ...result }, [result.pdf.buffer])
  } catch (error) {
    if (error instanceof NeedsDrawing) {
      post({ type: 'draw', assetIds: error.assetIds })
      return
    }
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
