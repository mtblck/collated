import type { DocState } from '../core/model'
import { assetStore } from '../import/assetStore'
import type { ExportRequest, ExportResponse } from './protocol'

export type Progress = (done: number, total: number) => void

const request = (state: DocState): ExportRequest => {
  const used = new Set(state.pages.map((p) => p.assetId))
  const assets = Object.fromEntries(Object.entries(state.assets).filter(([id]) => used.has(id)))
  // Pages of one PDF share its bytes: send each file once.
  const bytesIds = new Set(Object.values(assets).map((a) => a.bytesId))
  const bytes = Object.fromEntries([...bytesIds].map((id) => [id, assetStore.get(id)]))
  return { input: { settings: state.settings, pages: state.pages, assets }, bytes }
}

/** Builds the PDF in a module worker; resolves with the file. */
export const exportPdf = (state: DocState, onProgress?: Progress): Promise<Blob> => {
  const message = request(state)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), {
      type: 'module',
      name: 'collated-pdf',
    })
    const finish = () => {
      worker.terminate()
    }
    worker.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      if (data.type === 'progress') onProgress?.(data.done, data.total)
      else if (data.type === 'done') {
        finish()
        resolve(new Blob([data.pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }))
      } else {
        finish()
        reject(new Error(data.message))
      }
    }
    worker.onerror = (event) => {
      finish()
      reject(new Error(event.message || 'The PDF export failed to start.'))
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
