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

const baseName = (title: string, now: Date) => pdfFilename(title, now).replace(/\.pdf$/, '')

/** "Lease-part-03.pdf": the title's name, a label and a number padded to sort. */
const numbered = (
  title: string,
  label: string,
  index: number,
  total: number,
  ext: string,
  now: Date,
) =>
  `${baseName(title, now)}-${label}-${String(index + 1).padStart(String(total).length, '0')}.${ext}`

/** One part of a split export: "Lease-part-1.pdf", zero-padded so the files sort. */
export const partFilename = (title: string, index: number, total: number, now = new Date()) =>
  numbered(title, 'part', index, total, 'pdf', now)

/** The ZIP a split export downloads as. */
export const zipFilename = (title: string, now = new Date()) =>
  pdfFilename(title, now).replace(/\.pdf$/, '.zip')

/**
 * One page saved as an image (#117): "Lease.jpg" when it's the only one,
 * else "Lease-page-03.jpg" by its place in the export, zero-padded so the
 * files sort.
 */
export const imageFilename = (
  title: string,
  index: number,
  total: number,
  ext: string,
  now = new Date(),
) =>
  total === 1 ? `${baseName(title, now)}.${ext}` : numbered(title, 'page', index, total, ext, now)
