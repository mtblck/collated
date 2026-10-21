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
