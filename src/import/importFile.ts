import { sniff } from '../core/imageInfo'
import { inspectPdf, unlockPdf } from '../export/exportPdf'
import { importImage, type Imported } from './importImage'
import type { AskPassword } from './importPdf'

export type { Imported } from './importImage'
export type { AskPassword } from './importPdf'
export { ImportError } from './importImage'

export interface ImportOptions {
  onPage?: (done: number, total: number) => void
  /** Asks for the password of a PDF that needs one; without it, such a PDF is refused. */
  askPassword?: AskPassword
}

/**
 * One file in, one or more pages out: an image becomes a page, a PDF or a
 * TIFF one page per page. The type comes from the file's bytes, not its name.
 */
export const importFile = async (
  file: File,
  newId: () => string,
  { onPage, askPassword }: ImportOptions = {},
): Promise<Imported> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  if (kind === 'pdf') {
    const { importPdf } = await import('./importPdf')
    return importPdf(file, bytes, newId, {
      ...(onPage ? { onPage } : {}),
      inspect: inspectPdf,
      ...(askPassword ? { askPassword, unlock: unlockPdf } : {}),
    })
  }
  if (kind === 'tiff') {
    // Always ours, even in Safari: its native decode gives only the first
    // page, at no particular size.
    const { importTiff } = await import('./importTiff')
    return importTiff(file, bytes, newId, onPage)
  }
  return importImage(file, newId(), bytes, kind)
}
