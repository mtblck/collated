import type { Orientation, Settings } from '../core/model'
import { PAGE_SIZES } from '../core/pageSizes'
import { formatLength } from '../core/units'

export const ORIENTATIONS: readonly { value: Orientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

/** "US Letter · Auto · 0.5 in": the setup at a glance, on the button. */
export const setupSummary = (settings: Settings) => {
  const size =
    settings.size === 'custom'
      ? `${formatLength(settings.custom.width, settings.unit)} × ${formatLength(settings.custom.height, settings.unit)}`
      : settings.size === 'image'
        ? `Match image · ${String(settings.imageDpi)} dpi`
        : (PAGE_SIZES.find((s) => s.id === settings.size)?.label ?? settings.size)
  const orientation =
    settings.size === 'image'
      ? null
      : (ORIENTATIONS.find((o) => o.value === settings.orientation)?.label ?? null)
  const margin = `${formatLength(settings.margin, settings.unit)} margin`
  return [size, orientation, margin].filter(Boolean).join(' · ')
}
