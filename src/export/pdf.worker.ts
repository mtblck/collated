/// <reference lib="webworker" />
import { buildWithin, compressionFor } from '../core/compression'
import { buildPdf, type BuildInput } from '../core/pdf'
import { NeedsDrawing } from '../core/pdfSanitize'
import { unlockedCopy } from '../core/pdfUnlock'
import { listPdfImages } from '../core/pdfImages'
import { buildSplit } from '../core/splitBuild'
import { flattenToBlob, processToBlob, shrinkToJpeg } from '../lib/filterCanvas'
import type { ExportRequest, ExportResponse, InspectRequest, UnlockRequest } from './protocol'

/*
 * Builds the PDF off the main thread. Embedding passthrough JPEGs is cheap,
 * but filtering, resizing and PNG recompression can take seconds for a batch
 * and would otherwise freeze the page.
 */
declare const self: DedicatedWorkerGlobalScope

const post = (message: ExportResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer)
}

self.onmessage = async ({ data }: MessageEvent<ExportRequest | UnlockRequest | InspectRequest>) => {
  try {
    if ('unlock' in data) {
      const file = await unlockedCopy(data.unlock.bytes, data.unlock.password)
      post({ type: 'unlocked', file }, [file.buffer])
      return
    }
    if ('inspect' in data) {
      post({ type: 'inspected', pages: await listPdfImages(data.inspect.bytes) })
      return
    }
    const { settings } = data.input
    let attempt = 1
    /** One PDF, at smaller steps until it fits the size limit (each part of a split on its own). */
    const buildOne = (input: BuildInput, onProgress: (done: number, total: number) => void) => {
      return buildWithin(
        (compression) =>
          buildPdf(
            { ...input, compression },
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
              flattenPage: async (job) =>
                new Uint8Array(await (await flattenToBlob(job)).arrayBuffer()),
              shrinkImage: shrinkToJpeg,
              onProgress,
            },
          ),
        compressionFor(settings.quality),
        settings.maxBytes,
        (n) => {
          attempt = n
        },
      )
    }
    const progress = (done: number, total: number) => {
      post({ type: 'progress', done, total, attempt })
    }
    const result = data.parts
      ? await buildSplit(data.input, data.parts, buildOne, progress)
      : await buildOne(data.input, progress)
    post({ type: 'done', file: result.pdf, compression: result.compression, fits: result.fits }, [
      result.pdf.buffer,
    ])
  } catch (error) {
    if (error instanceof NeedsDrawing) {
      post({ type: 'draw', assetIds: error.assetIds })
      return
    }
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
