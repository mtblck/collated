import type { Compression } from '../core/compression'
import type { DocState } from '../core/model'
import type { OcrWord } from '../core/textLayer'
import { assetStore } from '../import/assetStore'
import type { ExportRequest, ExportResponse } from './protocol'

export type Progress = (done: number, total: number, attempt: number) => void

export interface Exported {
  blob: Blob
  /** The compression the file used: the chosen quality, or a smaller step to meet a size limit. */
  compression: Compression | null
  /** False when a size limit couldn't be met; the blob is then the smallest build tried. */
  fits: boolean
}

const request = (
  state: DocState,
  password?: string,
  text?: Record<string, OcrWord[]>,
): ExportRequest => {
  const used = new Set(state.pages.map((p) => p.assetId))
  const assets = Object.fromEntries(Object.entries(state.assets).filter(([id]) => used.has(id)))
  // Pages of one PDF share its bytes: send each file once.
  const bytesIds = new Set(Object.values(assets).map((a) => a.bytesId))
  const bytes = Object.fromEntries([...bytesIds].map((id) => [id, assetStore.get(id)]))
  return {
    input: {
      settings: state.settings,
      pages: state.pages,
      assets,
      ...(password ? { password } : {}),
      ...(text ? { text } : {}),
    },
    bytes,
  }
}

const START_FAILED =
  'The PDF export couldn’t start. If Collated was updated since this page was opened, reload the page and add your files again.'

/** Vite bundles a worker only from this exact `new Worker(new URL(…))` shape. */
const spawn = () => {
  const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
    type: 'module',
    name: 'collated-pdf',
  })
  return worker
}

/**
 * One export worker, started ahead of the first export and kept between
 * exports. Its code is a hashed file from the build this page came from: a
 * worker started only on Export, in a tab opened before a deploy, asks for a
 * file the new deploy no longer has (#42). Once loaded, a deploy can't touch it.
 */
let idle: { worker: Worker; failed: boolean } | null = null

/** Starts the export worker now, so Export never depends on fetching it later. */
export const prepareExport = () => {
  if (idle || typeof Worker === 'undefined') return
  const entry = { worker: spawn(), failed: false }
  // A load failure fires before any message; remember it for the export.
  entry.worker.onerror = () => {
    entry.failed = true
  }
  idle = entry
}

/** The ready worker if it loaded, else a fresh one. */
const takeWorker = () => {
  const entry = idle
  idle = null
  if (entry && !entry.failed) return entry.worker
  entry?.worker.terminate()
  return spawn()
}

/** Builds the PDF in the module worker; resolves with the file. */
export const exportPdf = (
  state: DocState,
  onProgress?: Progress,
  options: { password?: string; text?: Record<string, OcrWord[]> } = {},
): Promise<Exported> => {
  const message = request(state, options.password, options.text)
  return new Promise((resolve, reject) => {
    const worker = takeWorker()
    let started = false
    const release = () => {
      worker.onmessage = null
      worker.onerror = null
      // Keep a healthy worker for the next export; one is enough.
      if (idle) worker.terminate()
      else idle = { worker, failed: false }
      idle.worker.onerror = () => {
        if (idle) idle.failed = true
      }
    }
    worker.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      started = true
      if (data.type === 'progress') onProgress?.(data.done, data.total, data.attempt)
      else if (data.type === 'done') {
        release()
        resolve({
          blob: new Blob([data.pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
          compression: data.compression,
          fits: data.fits,
        })
      } else {
        release()
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      // Crashed or never loaded: don't reuse it.
      worker.terminate()
      reject(new Error(started && event.message ? event.message : START_FAILED))
    }
    worker.postMessage(message)
  })
}

/** Saves a blob through a temporary link; no server round-trip. */
export const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 30_000)
}
