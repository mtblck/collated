/*
 * Kept apart from pdf.ts so the UI can name the file without pulling pdf-lib
 * into the main bundle; pdf-lib loads only in the export worker.
 */
/** A filesystem-safe filename from the document title. */
export const pdfFilename = (title: string, now = new Date()): string => {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .replace(/\.pdf$/i, '')
  if (slug) return `${slug}.pdf`
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n) => String(n).padStart(2, '0'))
    .join('-')
  return `scans-${date}.pdf`
}

/** One part of a split export: "Lease-part-1.pdf", zero-padded so the files sort. */
export const partFilename = (title: string, index: number, total: number, now = new Date()) => {
  const base = pdfFilename(title, now).replace(/\.pdf$/, '')
  return `${base}-part-${String(index + 1).padStart(String(total).length, '0')}.pdf`
}

/** The ZIP a split export downloads as. */
export const zipFilename = (title: string, now = new Date()) =>
  pdfFilename(title, now).replace(/\.pdf$/, '.zip')
