import type { PaperGuess } from '../core/paper'

export interface PaperRequest {
  id: number
  /**
   * The page's upright thumbnail (a JPEG), or a downscaled camera frame
   * (#118), transferred.
   */
  thumb: Blob | ImageBitmap
}

export type PaperResponse =
  { id: number; ok: true; guess: PaperGuess | null } | { id: number; ok: false; message: string }
