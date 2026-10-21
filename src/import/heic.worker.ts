/// <reference lib="webworker" />
/*
 * Decodes HEIC/HEIF (iPhone photos) for browsers without native support —
 * everything but Safari. libheif compiled to WebAssembly (libheif-js,
 * LGPL-3.0) is loaded from our own origin on first use: the worker is
 * `worker-src 'self'`, the .wasm is fetched under `connect-src 'self'`, and
 * compiling it needs only `'wasm-unsafe-eval'`. libheif applies the image's
 * rotation and mirroring, so the pixels come back upright.
 */
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url'
import type { HeicRequest, HeicResponse } from './heicProtocol'

declare const self: DedicatedWorkerGlobalScope

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    done: (result: { data: Uint8ClampedArray } | null) => void,
  ): void
}
interface Libheif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] }
}

let libheif: Promise<Libheif> | undefined
const load = () =>
  (libheif ??= (async () => {
    const [{ default: factory }, wasm] = await Promise.all([
      // Its bundled types describe only the raw emscripten exports, not the
      // HeifDecoder wrapper we use, hence the narrow local interface.
      import('libheif-js/libheif-wasm/libheif.js') as unknown as Promise<{
        default: (options: { wasmBinary: ArrayBuffer }) => Libheif | Promise<Libheif>
      }>,
      fetch(wasmUrl).then((response) => {
        if (!response.ok) throw new Error(`HEIC decoder failed to load (${response.status})`)
        return response.arrayBuffer()
      }),
    ])
    return factory({ wasmBinary: wasm })
  })())

const post = (message: HeicResponse, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer)
}

self.onmessage = async ({ data }: MessageEvent<HeicRequest>) => {
  try {
    const heif = await load()
    const images = new heif.HeifDecoder().decode(new Uint8Array(data.bytes))
    const image = images.find((i) => i.is_primary()) ?? images[0]
    if (!image) throw new Error('No image in this HEIC file.')
    const width = image.get_width()
    const height = image.get_height()
    const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => {
        if (out) resolve(out.data)
        else reject(new Error('HEIC decode failed.'))
      })
    })
    post({ ok: true, width, height, pixels }, [pixels.buffer])
  } catch (error) {
    post({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}
