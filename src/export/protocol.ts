import type { BuildInput } from '../core/pdf'

export interface ExportRequest {
  input: BuildInput
  /** Bytes per `Asset.bytesId`. Structured-cloned (copied), not transferred: the page keeps its own. */
  bytes: Record<string, Uint8Array>
}

export type ExportResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; pdf: Uint8Array }
  | { type: 'error'; message: string }
