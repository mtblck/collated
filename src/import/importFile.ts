import { sniff } from '../core/imageInfo'
import { unlockPdf } from '../export/exportPdf'
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
 * One file in, one or more pages out: an image becomes a page, a PDF becomes
 * one page per PDF page. The type comes from the file's bytes, not its name.
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
      ...(askPassword ? { askPassword, unlock: unlockPdf } : {}),
    })
  }
  return importImage(file, newId(), bytes, kind)
}
