export interface HeicRequest {
  bytes: ArrayBuffer
}

export type HeicResponse =
  | { ok: true; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> }
  /** `tooLarge`: the header's size is over the import cap; nothing was decoded. */
  | { ok: false; message: string; tooLarge?: { width: number; height: number } }
