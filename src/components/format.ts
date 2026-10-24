import type { Asset, Page, SheetKind } from '../core/model'

/** Two-digit page numbers ("01", "12"), as the portfolio numbers its sections. */
export const pageNumber = (index: number) => String(index + 1).padStart(2, '0')

/** What each kind of combined page is called (#76). */
export const SHEET_NAMES: Record<SheetKind, string> = {
  two: '2 per page',
  four: '4 per page',
  'id-card': 'ID card',
}

/**
 * A page's name for its card and for screen readers: its file's name, or for
 * a combined page its layout and its pictures' names.
 */
export const pageName = (page: Page, assets: Readonly<Record<string, Pick<Asset, 'name'>>>) => {
  if (!page.sheet) return assets[page.assetId]?.name ?? ''
  const names = page.sheet.slots.map((slot) => assets[slot.assetId]?.name ?? '')
  return `${SHEET_NAMES[page.sheet.kind]}: ${names.join(', ')}`
}

/** When the saved copy was last written, in words: "today at 14:02", "on 21 Oct at 09:15". */
export const savedWhen = (savedAt: number, now = Date.now(), locale?: string) => {
  const at = new Date(savedAt)
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date) => d.toDateString()
  if (day(at) === day(new Date(now))) return `today at ${time}`
  if (day(at) === day(new Date(now - 86_400_000))) return `yesterday at ${time}`
  return `on ${at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} at ${time}`
}
