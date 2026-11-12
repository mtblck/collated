/**
 * Languages OCR can read (#79): Tesseract's "best_int" data for each,
 * self-hosted under `ocr/lang/` by ocr-assets.ts and fetched only when chosen.
 * Words in Windows-1252 go in the text layer in standard Helvetica, others in
 * an embedded glyphless font (#94, ADR 0025). Right-to-left lines go in in the
 * order they sit on the page and Chinese and Japanese words are joined without
 * spaces (#139, ADR 0030; `arrangeLine` in core/textLayer.ts). Vertical
 * Chinese and Japanese aren't offered: their models and text need their own
 * handling (a ticket of its own).
 */
export const OCR_LANGUAGES = [
  // `tags`: the BCP 47 tags that default to it, a language or a language and
  // script; the first is the PDF's /Lang. `mb`: the gzipped data's size, shown
  // before the first download (ocrAssets.test.ts keeps it true).
  { code: 'eng', label: 'English', tags: ['en'], mb: 2.9 },
  { code: 'ara', label: 'Arabic (العربية)', tags: ['ar'], mb: 1.7 },
  { code: 'bul', label: 'Bulgarian (български)', tags: ['bg'], mb: 1.4 },
  { code: 'chi_sim', label: 'Chinese, simplified (简体中文)', tags: ['zh-Hans'], mb: 1.7 },
  { code: 'chi_tra', label: 'Chinese, traditional (繁體中文)', tags: ['zh-Hant'], mb: 1.7 },
  { code: 'hrv', label: 'Croatian (hrvatski)', tags: ['hr'], mb: 2.3 },
  { code: 'ces', label: 'Czech (čeština)', tags: ['cs'], mb: 2.2 },
  { code: 'dan', label: 'Danish (dansk)', tags: ['da'], mb: 1.8 },
  { code: 'nld', label: 'Dutch (Nederlands)', tags: ['nl'], mb: 3 },
  { code: 'fin', label: 'Finnish (suomi)', tags: ['fi'], mb: 3.8 },
  { code: 'fra', label: 'French (français)', tags: ['fr'], mb: 0.7 },
  { code: 'deu', label: 'German (Deutsch)', tags: ['de'], mb: 1.3 },
  { code: 'ell', label: 'Greek (Ελληνικά)', tags: ['el'], mb: 1.3 },
  { code: 'heb', label: 'Hebrew (עברית)', tags: ['he', 'iw'], mb: 0.6 },
  { code: 'hun', label: 'Hungarian (magyar)', tags: ['hu'], mb: 2.9 },
  { code: 'ita', label: 'Italian (italiano)', tags: ['it'], mb: 1.7 },
  { code: 'jpn', label: 'Japanese (日本語)', tags: ['ja'], mb: 2 },
  { code: 'kor', label: 'Korean (한국어)', tags: ['ko'], mb: 1.6 },
  { code: 'nor', label: 'Norwegian (norsk)', tags: ['no', 'nb', 'nn'], mb: 2.5 },
  { code: 'fas', label: 'Persian (فارسی)', tags: ['fa'], mb: 0.4 },
  { code: 'pol', label: 'Polish (polski)', tags: ['pl'], mb: 2.6 },
  { code: 'por', label: 'Portuguese (português)', tags: ['pt'], mb: 1.4 },
  { code: 'ron', label: 'Romanian (română)', tags: ['ro', 'mo'], mb: 1.7 },
  { code: 'rus', label: 'Russian (русский)', tags: ['ru'], mb: 2.7 },
  { code: 'slk', label: 'Slovak (slovenčina)', tags: ['sk'], mb: 2.4 },
  { code: 'slv', label: 'Slovenian (slovenščina)', tags: ['sl'], mb: 1.3 },
  { code: 'spa', label: 'Spanish (español)', tags: ['es'], mb: 2.1 },
  { code: 'swe', label: 'Swedish (svenska)', tags: ['sv'], mb: 2.5 },
  { code: 'tur', label: 'Turkish (Türkçe)', tags: ['tr'], mb: 2.1 },
  { code: 'ukr', label: 'Ukrainian (українська)', tags: ['uk'], mb: 2.1 },
  { code: 'urd', label: 'Urdu (اردو)', tags: ['ur'], mb: 1 },
] as const

export type OcrLanguage = (typeof OCR_LANGUAGES)[number]['code']

export const isOcrLanguage = (value: unknown): value is OcrLanguage =>
  OCR_LANGUAGES.some((l) => l.code === value)

export const ocrLanguageInfo = (code: OcrLanguage) =>
  OCR_LANGUAGES.find((l) => l.code === code) ?? OCR_LANGUAGES[0]

/** The visitor's own language when OCR can read it, else English. */
export const defaultOcrLanguage = (locale: string): OcrLanguage => {
  let tags: string[]
  try {
    // With its likely script, so zh-TW and zh-HK find traditional Chinese.
    const { language, script } = new Intl.Locale(locale).maximize()
    tags = script ? [`${language}-${script}`, language] : [language]
  } catch {
    return 'eng'
  }
  for (const tag of tags) {
    const found = OCR_LANGUAGES.find((l) => (l.tags as readonly string[]).includes(tag))
    if (found) return found.code
  }
  return 'eng'
}
