import type { Compression } from '../core/compression'
import type { Imposition } from '../core/impose'
import { usedAssetIds } from '../core/marks'
import { isRedacted, picturesOf, type DocState } from '../core/model'
import type { OutlineItem } from '../core/outline'
import type { SplitPart } from '../core/splitBuild'
import type { OcrWord } from '../core/textLayer'
import { assetStore } from '../import/assetStore'
import { layeredImage } from './layered'
import type { PdfImageInfo } from '../core/pdfImages'
import type { ExportRequest, ExportResponse, InspectRequest, UnlockRequest } from './protocol'

export type Progress = (done: number, total: number, attempt: number) => void

export interface Exported {
  blob: Blob
  /** The compression the file used: the chosen quality, or a smaller step to meet a size limit. */
  compression: Compression | null
  /** False when a size limit couldn't be met; the blob is then the smallest build tried. */
  fits: boolean
}

/**
 * Drawn JPEGs for the PDF pages that hide something, and those with
 * something blacked out (#77), by asset id (see layered.ts).
 */
const drawLayered = async (state: DocState) => {
  const drawn: Record<string, Uint8Array> = {}
  const used = usedAssetIds(state)
  const redacted = new Set(
    state.pages.flatMap((p) =>
      picturesOf(p)
        .filter(isRedacted)
        .map((slot) => slot.assetId),
    ),
  )
  for (const asset of Object.values(state.assets)) {
    if (asset.format !== 'pdf' || !used.has(asset.id)) continue
    const jpeg = await layeredImage(asset, redacted.has(asset.id))
    if (jpeg) drawn[asset.id] = jpeg
  }
  return drawn
}

const request = (
  state: DocState,
  password?: string,
  text?: Record<string, OcrWord[]>,
  drawn: Record<string, Uint8Array> = {},
  parts?: SplitPart[],
  outline?: OutlineItem[],
  print?: Imposition,
): ExportRequest => {
  const used = usedAssetIds(state)
  const assets = Object.fromEntries(Object.entries(state.assets).filter(([id]) => used.has(id)))
  const rendered = Object.fromEntries(Object.keys(drawn).map((id) => [id, `drawn:${id}`]))
  // Pages of one PDF share its bytes: send each file once, and not at all
  // when every page of it goes as a drawing.
  const bytesIds = new Set(
    Object.values(assets)
      .filter((a) => !(a.id in drawn))
      .map((a) => a.bytesId),
  )
  const bytes = {
    ...Object.fromEntries([...bytesIds].map((id) => [id, assetStore.get(id)])),
    ...Object.fromEntries(Object.entries(drawn).map(([id, jpeg]) => [`drawn:${id}`, jpeg])),
  }
  return {
    input: {
      settings: state.settings,
      pages: state.pages,
      assets,
      ...(password ? { password } : {}),
      ...(text ? { text } : {}),
      ...(Object.keys(rendered).length ? { rendered } : {}),
      ...(outline?.length ? { outline } : {}),
      ...(print ? { print } : {}),
    },
    bytes,
    ...(parts ? { parts } : {}),
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

/** Hands a worker back once it has answered: kept for the next job if none is waiting, else ended. */
const giveBack = (worker: Worker) => {
  worker.onmessage = null
  worker.onerror = null
  // Keep a healthy worker for the next export; one is enough.
  if (idle) worker.terminate()
  else idle = { worker, failed: false }
  idle.worker.onerror = () => {
    if (idle) idle.failed = true
  }
}

/**
 * A copy of a password-protected PDF that needs no password (#114), made by
 * the export worker (pdf-lib stays out of the page). Rejects if pdf-lib
 * can't open it.
 */
export const unlockPdf = (bytes: Uint8Array, password: string): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const worker = takeWorker()
    worker.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      giveBack(worker)
      if (data.type === 'unlocked') resolve(data.file)
      else reject(new Error(data.type === 'error' ? data.message : 'Unexpected answer.'))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || START_FAILED))
    }
    const message: UnlockRequest = { unlock: { bytes, password } }
    worker.postMessage(message)
  })

/** The last listing asked for (see `inspectPdf`). */
let inspecting: Promise<unknown> = Promise.resolve()

/**
 * The pictures each page of a PDF draws that the export could shrink (#115),
 * read by the export worker, for the size estimate.
 */
export const inspectPdf = (bytes: Uint8Array): Promise<PdfImageInfo[][]> => {
  // One file at a time: several big PDFs dropped together would otherwise
  // each start a worker holding its own copy.
  const turn = inspecting.then(() => inspectNow(bytes))
  inspecting = turn.catch(() => undefined)
  return turn
}
const inspectNow = (bytes: Uint8Array): Promise<PdfImageInfo[][]> =>
  new Promise((resolve, reject) => {
    const worker = takeWorker()
    worker.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      giveBack(worker)
      if (data.type === 'inspected') resolve(data.pages)
      else reject(new Error(data.type === 'error' ? data.message : 'Unexpected answer.'))
    }
    worker.onerror = (event) => {
      worker.terminate()
      reject(new Error(event.message || START_FAILED))
    }
    const message: InspectRequest = { inspect: { bytes } }
    worker.postMessage(message)
  })

/**
 * Builds the PDF in the module worker; resolves with the file. With `parts`,
 * each is built as its own PDF and the file is a ZIP of them (#66);
 * `state.pages` then holds every page the parts use.
 */
export const exportPdf = (
  state: DocState,
  onProgress?: Progress,
  options: {
    password?: string
    text?: Record<string, OcrWord[]>
    /**
     * Reads the words on pages drawn only because the export's own check
     * asked (see below); their words are added to `text`. With OCR off, unset.
     */
    readDrawn?: (assetId: string, jpeg: Uint8Array) => Promise<Record<string, OcrWord[]>>
    parts?: SplitPart[]
    /** Bookmarks for the single file; parts carry their own. */
    outline?: OutlineItem[]
    /** Prints the pages as a booklet or poster (#119), each part on its own. */
    print?: Imposition
  } = {},
): Promise<Exported> => {
  const { parts, outline, print } = options
  const type = parts ? 'application/zip' : 'application/pdf'
  const hasPdf = [...usedAssetIds(state)].some((id) => state.assets[id]?.format === 'pdf')
  const finish = (result: Exported | { draw: string[] }) => {
    if ('draw' in result) throw new Error('A PDF page that hides a layer could not be drawn.')
    return result
  }
  // Without PDF pages there's nothing to draw first: post straight away.
  if (!hasPdf) {
    return send(
      request(state, options.password, options.text, {}, parts, outline, print),
      type,
      onProgress,
    ).then(finish)
  }
  return (async () => {
    const drawn = await drawLayered(state)
    const first = await send(
      request(state, options.password, options.text, drawn, parts, outline, print),
      type,
      onProgress,
    )
    if (!('draw' in first)) return first
    // The export's own check found pages that could hide something, which
    // the preview's didn't flag: draw those too, and build once more.
    for (const id of first.draw) {
      const asset = state.assets[id]
      const jpeg = asset && !(id in drawn) ? await layeredImage(asset, true) : null
      if (!jpeg) throw new Error('A PDF page that hides a layer could not be drawn.')
      drawn[id] = jpeg
    }
    let text = options.text
    if (options.readDrawn) {
      text = { ...text }
      for (const id of first.draw) {
        const jpeg = drawn[id]
        if (jpeg) Object.assign(text, await options.readDrawn(id, jpeg))
      }
    }
    return finish(
      await send(
        request(state, options.password, text, drawn, parts, outline, print),
        type,
        onProgress,
      ),
    )
  })()
}

const send = (
  message: ExportRequest,
  type: string,
  onProgress?: Progress,
): Promise<Exported | { draw: string[] }> => {
  return new Promise((resolve, reject) => {
    const worker = takeWorker()
    let started = false
    const release = () => {
      giveBack(worker)
    }
    worker.onmessage = ({ data }: MessageEvent<ExportResponse>) => {
      started = true
      if (data.type === 'progress') onProgress?.(data.done, data.total, data.attempt)
      else if (data.type === 'done') {
        release()
        resolve({
          blob: new Blob([data.file as Uint8Array<ArrayBuffer>], { type }),
          compression: data.compression,
          fits: data.fits,
        })
      } else if (data.type === 'draw') {
        release()
        resolve({ draw: data.assetIds })
      } else {
        release()
        reject(new Error(data.type === 'error' ? data.message : 'Unexpected answer.'))
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
