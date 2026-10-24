import type { Compression } from '../core/compression'
import type { BuildInput } from '../core/pdf'
import type { SplitPart } from '../core/splitBuild'

export interface ExportRequest {
  input: BuildInput
  /** Bytes per `Asset.bytesId`. Structured-cloned (copied), not transferred: the page keeps its own. */
  bytes: Record<string, Uint8Array>
  /**
   * Builds each part as its own PDF, with the same settings, and answers
   * with one ZIP of them. `input.pages` then holds every page used.
   */
  parts?: SplitPart[]
}

export type ExportResponse =
  | { type: 'progress'; done: number; total: number; attempt: number }
  /** `file` is the PDF, or the ZIP when the request had parts; `compression` is the smallest step any part needed. */
  | { type: 'done'; file: Uint8Array; compression: Compression | null; fits: boolean }
  | { type: 'error'; message: string }
  /** These PDF pages could hide something: draw them and ask again. */
  | { type: 'draw'; assetIds: string[] }
