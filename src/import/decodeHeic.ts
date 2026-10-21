import type { HeicRequest, HeicResponse } from './heicProtocol'

/**
 * Decodes a HEIC file to an upright ImageBitmap in the HEIC worker. One
 * worker is kept for the session so libheif compiles once, not per photo.
 */
let worker: Worker | undefined
let queue: Promise<unknown> = Promise.resolve()

const getWorker = () =>
  (worker ??= new Worker(new URL('./heic.worker.ts', import.meta.url), {
    type: 'module',
    name: 'collated-heic',
  }))

const run = (bytes: ArrayBuffer) =>
  new Promise<ImageBitmap>((resolve, reject) => {
    const w = getWorker()
    w.onmessage = ({ data }: MessageEvent<HeicResponse>) => {
      if (!data.ok) {
        reject(new Error(data.message))
        return
      }
      const image = new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height)
      createImageBitmap(image).then(resolve, reject)
    }
    w.onerror = (event) => {
      reject(new Error(event.message || 'The HEIC decoder failed to start.'))
    }
    const request: HeicRequest = { bytes }
    w.postMessage(request, [bytes])
  })

/** Decodes one file at a time: libheif in one worker handles one image at once. */
export const decodeHeic = async (file: Blob): Promise<ImageBitmap> => {
  const bytes = await file.arrayBuffer()
  const result = queue.then(() => run(bytes))
  queue = result.catch(() => undefined)
  return result
}
