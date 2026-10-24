import type { Settings } from '../core/model'
import { PAGE_NUMBER_START_MAX } from '../core/limits'
import { defaultOcrLanguage, isOcrLanguage } from '../core/ocrLanguages'
import { PAGE_SIZES, localeDefaults } from '../core/pageSizes'

const KEY = 'collated:settings'

/**
 * Fresh settings for this visitor: their locale's paper and OCR language,
 * auto orientation, no margin.
 */
export const defaultSettings = (locale: string): Settings => {
  const { size, unit } = localeDefaults(locale)
  const preset = PAGE_SIZES.find((p) => p.id === size) ?? PAGE_SIZES[0]
  return {
    size,
    unit,
    custom: { width: preset?.width ?? 612, height: preset?.height ?? 792 },
    orientation: 'auto',
    margin: 0,
    title: '',
    quality: 'original',
    maxBytes: null,
    imageDpi: 300,
    pageNumbers: { show: false, position: 'bottom-center', start: 1 },
    ocr: false,
    ocrLanguage: defaultOcrLanguage(locale),
    bookmarkFiles: false,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

/**
 * Remembers page setup between visits — a convenience, so anything missing,
 * malformed or unreadable (private mode) falls back to the defaults. The
 * title is per-document and never stored.
 */
export const loadSettings = (
  storage: Pick<Storage, 'getItem'> | undefined,
  locale: string,
): Settings => {
  const fallback = defaultSettings(locale)
  try {
    const raw: unknown = JSON.parse(storage?.getItem(KEY) ?? 'null')
    if (!isRecord(raw)) return fallback
    const size =
      PAGE_SIZES.some((p) => p.id === raw.size) || raw.size === 'custom' || raw.size === 'image'
        ? raw.size
        : fallback.size
    const custom = isRecord(raw.custom) ? raw.custom : {}
    return {
      size: size as Settings['size'],
      unit: raw.unit === 'in' || raw.unit === 'mm' ? raw.unit : fallback.unit,
      orientation:
        raw.orientation === 'portrait' ||
        raw.orientation === 'landscape' ||
        raw.orientation === 'auto'
          ? raw.orientation
          : fallback.orientation,
      margin: Math.max(0, finite(raw.margin, fallback.margin)),
      custom: {
        width: finite(custom.width, fallback.custom.width),
        height: finite(custom.height, fallback.custom.height),
      },
      title: '',
      quality:
        raw.quality === 'high' || raw.quality === 'balanced' || raw.quality === 'small'
          ? raw.quality
          : 'original',
      maxBytes:
        typeof raw.maxBytes === 'number' && Number.isFinite(raw.maxBytes) && raw.maxBytes > 0
          ? raw.maxBytes
          : null,
      ocr: raw.ocr === true,
      ocrLanguage: isOcrLanguage(raw.ocrLanguage) ? raw.ocrLanguage : fallback.ocrLanguage,
      bookmarkFiles: raw.bookmarkFiles === true,
      imageDpi: Math.min(1200, Math.max(36, finite(raw.imageDpi, fallback.imageDpi))),
      pageNumbers: {
        show: isRecord(raw.pageNumbers) && raw.pageNumbers.show === true,
        position:
          isRecord(raw.pageNumbers) &&
          (raw.pageNumbers.position === 'bottom-right' || raw.pageNumbers.position === 'top-right')
            ? raw.pageNumbers.position
            : 'bottom-center',
        start: Math.min(
          PAGE_NUMBER_START_MAX,
          Math.max(0, Math.round(finite(isRecord(raw.pageNumbers) ? raw.pageNumbers.start : 1, 1))),
        ),
      },
    }
  } catch {
    return fallback
  }
}

export const saveSettings = (storage: Pick<Storage, 'setItem'> | undefined, settings: Settings) => {
  try {
    const { title, ...rest } = settings
    storage?.setItem(KEY, JSON.stringify(rest))
  } catch {
    /* storage full or blocked: the setting just won't persist */
  }
}

const KEEP_WORK_KEY = 'collated:keep-work'

/** Whether the document is kept on this device between visits (#74). On unless turned off. */
export const loadKeepWork = (storage: Pick<Storage, 'getItem'> | undefined): boolean => {
  try {
    return storage?.getItem(KEEP_WORK_KEY) !== 'off'
  } catch {
    return true
  }
}

export const saveKeepWork = (storage: Pick<Storage, 'setItem'> | undefined, keep: boolean) => {
  try {
    storage?.setItem(KEEP_WORK_KEY, keep ? 'on' : 'off')
  } catch {
    /* storage blocked: the choice lasts until the tab closes */
  }
}
