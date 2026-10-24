import type { PaperGuess } from '../core/paper'

export interface PaperRequest {
  id: number
  /** The page's upright thumbnail (a JPEG). */
  thumb: Blob
}

export type PaperResponse =
  { id: number; ok: true; guess: PaperGuess | null } | { id: number; ok: false; message: string }
