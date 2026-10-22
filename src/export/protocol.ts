import type { Compression } from '../core/compression'
import type { BuildInput } from '../core/pdf'

export interface ExportRequest {
  input: BuildInput
  /** Bytes per `Asset.bytesId`. Structured-cloned (copied), not transferred: the page keeps its own. */
  bytes: Record<string, Uint8Array>
}

export type ExportResponse =
  | { type: 'progress'; done: number; total: number; attempt: number }
  | { type: 'done'; pdf: Uint8Array; compression: Compression | null; fits: boolean }
  | { type: 'error'; message: string }
  /** These PDF pages could hide something: draw them and ask again. */
  | { type: 'draw'; assetIds: string[] }
