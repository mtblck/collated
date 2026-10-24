/**
 * Languages OCR can read (#79): Tesseract's "best_int" data for each,
 * self-hosted under `ocr/lang/` by ocr-assets.ts and fetched only when chosen.
 * Only languages whose letters are all in Windows-1252 are offered, because
 * the text layer is written in a standard font with that encoding (see
 * `drawTextLayer` in core/pdf.ts); non-Latin scripts would need an embedded
 * font (ADR 0011).
 */
export const OCR_LANGUAGES = [
  // `tags`: the BCP 47 language subtags that default to it. `mb`: the
  // gzipped data's size, shown before the first download (ocrAssets.test.ts
  // keeps it true).
  { code: 'eng', label: 'English', tags: ['en'], mb: 2.9 },
  { code: 'dan', label: 'Danish (dansk)', tags: ['da'], mb: 1.8 },
  { code: 'nld', label: 'Dutch (Nederlands)', tags: ['nl'], mb: 3 },
  { code: 'fin', label: 'Finnish (suomi)', tags: ['fi'], mb: 3.8 },
  { code: 'fra', label: 'French (français)', tags: ['fr'], mb: 0.7 },
  { code: 'deu', label: 'German (Deutsch)', tags: ['de'], mb: 1.3 },
  { code: 'ita', label: 'Italian (italiano)', tags: ['it'], mb: 1.7 },
  { code: 'nor', label: 'Norwegian (norsk)', tags: ['no', 'nb', 'nn'], mb: 2.5 },
  { code: 'por', label: 'Portuguese (português)', tags: ['pt'], mb: 1.4 },
  { code: 'spa', label: 'Spanish (español)', tags: ['es'], mb: 2.1 },
  { code: 'swe', label: 'Swedish (svenska)', tags: ['sv'], mb: 2.5 },
] as const

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code']

export const isOcrLanguage = (value: unknown): value is OcrLanguage =>
  OCR_LANGUAGES.some((l) => l.code === value)

export const ocrLanguageInfo = (code: OcrLanguage) =>
  OCR_LANGUAGES.find((l) => l.code === code) ?? OCR_LANGUAGES[0]

/** The visitor's own language when OCR can read it, else English. */
export const defaultOcrLanguage = (locale: string): OcrLanguage => {
  let tag: string
  try {
    tag = new Intl.Locale(locale).language
  } catch {
    return 'eng'
  }
  return OCR_LANGUAGES.find((l) => (l.tags as readonly string[]).includes(tag))?.code ?? 'eng'
}
