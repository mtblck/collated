import type { Orientation, PageSizeId, Settings, Unit } from './model'
import { toPoints } from './units'

export interface PageSizePreset {
  id: Exclude<PageSizeId, 'custom'>
  label: string
  /** Portrait width and height in points. */
  width: number
  height: number
}

const mm = (value: number) => toPoints(value, 'mm')

export const PAGE_SIZES: readonly PageSizePreset[] = [
  { id: 'letter', label: 'US Letter', width: 612, height: 792 },
  { id: 'legal', label: 'US Legal', width: 612, height: 1008 },
  { id: 'tabloid', label: 'Tabloid', width: 792, height: 1224 },
  { id: 'a5', label: 'A5', width: mm(148), height: mm(210) },
  { id: 'a4', label: 'A4', width: mm(210), height: mm(297) },
  { id: 'a3', label: 'A3', width: mm(297), height: mm(420) },
]

/** Countries that use US paper sizes rather than ISO 216. */
const LETTER_REGIONS = new Set([
  'US',
  'CA',
  'MX',
  'PH',
  'CL',
  'CO',
  'VE',
  'GT',
  'CR',
  'PA',
  'DO',
  'PR',
])

/** Letter + inches where that's the local paper, A4 + millimetres elsewhere. */
export const localeDefaults = (locale: string): { size: PageSizeId; unit: Unit } => {
  let region: string | undefined
  try {
    region = new Intl.Locale(locale).maximize().region
  } catch {
    region = undefined
  }
  return region && LETTER_REGIONS.has(region)
    ? { size: 'letter', unit: 'in' }
    : { size: 'a4', unit: 'mm' }
}

/** The page's base size in points, in its own (unrotated) sense. */
export const baseSize = (settings: Pick<Settings, 'size' | 'custom'>) => {
  if (settings.size === 'custom') return settings.custom
  // 'image' pages are sized per page in layoutPage; this is only reached for
  // a fallback (e.g. a placeholder), so give it Letter.
  if (settings.size === 'image') return { width: 612, height: 792 }
  const preset = PAGE_SIZES.find((p) => p.id === settings.size)
  if (!preset) throw new Error(`Unknown page size: ${settings.size}`)
  return { width: preset.width, height: preset.height }
}

/**
 * Final page size in points. `auto` turns the page to match the image as it
 * will sit on the page (after rotation), so a landscape photo gets a
 * landscape page instead of a thin strip across a portrait one.
 */
export const pageSize = (
  settings: Pick<Settings, 'size' | 'custom' | 'orientation'>,
  imageIsLandscape: boolean,
): { width: number; height: number } => {
  const { width, height } = baseSize(settings)
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  const orientation: Exclude<Orientation, 'auto'> =
    settings.orientation === 'auto'
      ? imageIsLandscape
        ? 'landscape'
        : 'portrait'
      : settings.orientation
  return orientation === 'landscape'
    ? { width: long, height: short }
    : { width: short, height: long }
}
