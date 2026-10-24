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
