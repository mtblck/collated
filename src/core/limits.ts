/** PDF's page-size ceiling is 14,400 pt (200 in); a page under ½ in is a mistake. */
export const PAGE_MIN = 36
export const PAGE_MAX = 14_400

/**
 * The largest image accepted at import, in pixels (width × height). Decoding
 * one means an RGBA buffer of 4 bytes a pixel — 400 MB at this cap — and the
 * crop, filter, OCR and PNG-embedding paths each decode at full size. Phone
 * photos are 12–48 MP and a 600 dpi Letter scan is 34 MP; a header claiming
 * more than this is far more likely a hostile or broken file than a page.
 */
export const MAX_IMPORT_PIXELS = 100_000_000

/**
 * Pages accepted from one PDF. Each page renders a thumbnail at import, so a
 * tiny file declaring 100,000 pages would otherwise hold the tab for minutes.
 */
export const MAX_PDF_PAGES = 500

/** The page-number field's range. */
export const PAGE_NUMBER_START_MAX = 9999
