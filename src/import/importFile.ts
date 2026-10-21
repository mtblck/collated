import { sniff } from '../core/imageInfo'
import { importImage, type Imported } from './importImage'

export type { Imported } from './importImage'
export { ImportError } from './importImage'

/**
 * One file in, one or more pages out: an image becomes a page, a PDF becomes
 * one page per PDF page. The type comes from the file's bytes, not its name.
 */
export const importFile = async (
  file: File,
  newId: () => string,
  onPage?: (done: number, total: number) => void,
): Promise<Imported> => {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  if (kind === 'pdf') {
    const { importPdf } = await import('./importPdf')
    return importPdf(file, bytes, newId, onPage)
  }
  return importImage(file, newId(), bytes, kind)
}
