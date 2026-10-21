import { MAX_IMPORT_PIXELS } from '../core/limits'

/** A user-facing reason a file couldn't be added. */
export class ImportError extends Error {
  override name = 'ImportError'
}

/** The error for an image over the import pixel cap, or null if it's within it. */
export const tooManyPixels = (width: number, height: number): ImportError | null => {
  if (width * height <= MAX_IMPORT_PIXELS) return null
  const mp = (n: number) => Math.round(n / 1_000_000)
  return new ImportError(
    `This image is too large (${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} pixels, ${mp(width * height)} megapixels). ` +
      `Images up to ${mp(MAX_IMPORT_PIXELS)} megapixels can be added; scale it down and try again.`,
  )
}

/**
 * Refuses an image over the import pixel cap, from the size its header
 * claims — before anything allocates a buffer for it.
 */
export const assertImportPixels = (width: number, height: number) => {
  const error = tooManyPixels(width, height)
  if (error) throw error
}
