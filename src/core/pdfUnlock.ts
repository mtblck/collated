import { PDFDocument } from '@cantoo/pdf-lib'

/**
 * A copy of a password-protected PDF that opens without one (#114), for the
 * export worker only (pdf-lib stays out of the page). The pages, their
 * text, fonts and layers come through as they are, so nothing is redrawn;
 * the password itself goes nowhere, and only this copy is kept.
 */
export const unlockedCopy = async (bytes: Uint8Array, password: string) => {
  const doc = await PDFDocument.load(bytes, { password, updateMetadata: false })
  return doc.save()
}
