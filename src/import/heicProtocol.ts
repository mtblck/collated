export interface HeicRequest {
  bytes: ArrayBuffer
}

export type HeicResponse =
  | { ok: true; width: number; height: number; pixels: Uint8ClampedArray }
  | { ok: false; message: string }
