import { useId, useRef } from 'react'
import type { PageSizeId, Settings, Unit } from '../core/model'
import { PAGE_SIZES } from '../core/pageSizes'
import { PAGE_MAX, PAGE_MIN } from '../core/reducer'
import { fromPoints, roundForUnit, toPoints } from '../core/units'
import { ORIENTATIONS, setupSummary } from './setupSummary'
import { FieldLabel, Segmented } from './controls'
import { cx } from './cx'
import { PageIcon } from './Icons'
import { NumberField } from './NumberField'
import { POPOVER_BOX, POPOVER_PANEL, useCloseOnFocusOut } from './popover'
import { TOOLBAR_ITEM } from './toolbarItem'

const UNITS: readonly { value: Unit; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'in', label: 'in' },
]

/**
 * Settings for the whole document, set once and rarely changed: page size,
 * orientation, margins and units. A popover off the toolbar, so they don't
 * hold a row of the screen while you work on pages.
 */
export const PageSetup = ({
  settings,
  onSettings,
}: {
  settings: Settings
  onSettings: (patch: Partial<Settings>) => void
}) => {
  const id = useId()
  const panelId = `${id}-page-setup`
  const panel = useRef<HTMLDivElement>(null)
  useCloseOnFocusOut(panel, panelId)
  const { unit } = settings
  const unitName = unit === 'in' ? 'inches' : 'millimetres'
  const inUnit = (points: number) => roundForUnit(fromPoints(points, unit), unit)
  const step = unit === 'in' ? 0.05 : 1
  const limits = { min: inUnit(PAGE_MIN), max: inUnit(PAGE_MAX) }
  const summary = setupSummary(settings)

  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        {...TOOLBAR_ITEM}
        className="anchor-setup flex h-9 min-w-0 items-center gap-2 rounded-full border border-control px-3.5 text-left text-sm text-ink hover:bg-ink/[0.06] sm:border-transparent"
      >
        <PageIcon width={16} height={16} className="shrink-0 text-ink-muted" />
        <span className="sr-only">Page setup:</span>
        <span className="max-w-[50vw] truncate sm:max-w-none">{summary}</span>
      </button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        ref={panel}
        className={cx(POPOVER_PANEL, POPOVER_BOX, 'popover-start from-setup')}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          Page setup
        </h2>
        <p className="mt-1 text-xs text-ink-muted">For every page of the PDF.</p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <FieldLabel htmlFor={`${id}-size`}>Page size</FieldLabel>
            <select
              id={`${id}-size`}
              className="field w-full"
              value={settings.size}
              onChange={(event) => {
                onSettings({ size: event.target.value as PageSizeId })
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size.id} value={size.id}>
                  {size.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
              <option value="image">Match image</option>
            </select>
          </div>

          {settings.size === 'image' && (
            <div>
              <FieldLabel htmlFor={`${id}-dpi`}>Image dpi</FieldLabel>
              <NumberField
                id={`${id}-dpi`}
                className="w-28"
                value={settings.imageDpi}
                min={36}
                max={1200}
                step={10}
                suffix="dpi"
                aria-describedby={`${id}-dpi-hint`}
                onCommit={(imageDpi) => {
                  onSettings({ imageDpi })
                }}
              />
              <p id={`${id}-dpi-hint`} className="mt-1.5 text-xs text-ink-muted">
                Each page is sized to its image at this resolution. PDF pages keep their own size.
              </p>
            </div>
          )}

          {settings.size === 'custom' && (
            <fieldset className="flex items-end gap-2">
              <legend className="label mb-2 text-ink-faint">Custom size</legend>
              <NumberField
                id={`${id}-w`}
                className="w-28"
                aria-label={`Width in ${unitName}`}
                value={inUnit(settings.custom.width)}
                step={step}
                {...limits}
                suffix={unit}
                onCommit={(value) => {
                  onSettings({ custom: { ...settings.custom, width: toPoints(value, unit) } })
                }}
              />
              <span className="pb-2 text-ink-faint" aria-hidden="true">
                ×
              </span>
              <NumberField
                id={`${id}-h`}
                className="w-28"
                aria-label={`Height in ${unitName}`}
                value={inUnit(settings.custom.height)}
                step={step}
                {...limits}
                suffix={unit}
                onCommit={(value) => {
                  onSettings({ custom: { ...settings.custom, height: toPoints(value, unit) } })
                }}
              />
            </fieldset>
          )}

          <Segmented
            legend="Orientation"
            value={settings.size === 'image' ? 'auto' : settings.orientation}
            options={ORIENTATIONS}
            disabled={settings.size === 'image'}
            {...(settings.size === 'image' ? { describedBy: `${id}-dpi-hint` } : {})}
            onChange={(orientation) => {
              onSettings({ orientation })
            }}
          />

          <div className="flex items-end gap-4">
            <div className="w-28">
              <FieldLabel htmlFor={`${id}-margin`}>
                Margin <span className="sr-only">in {unitName}</span>
              </FieldLabel>
              <NumberField
                id={`${id}-margin`}
                value={inUnit(settings.margin)}
                min={0}
                max={unit === 'in' ? 4 : 100}
                step={step}
                suffix={unit}
                onCommit={(value) => {
                  onSettings({ margin: toPoints(value, unit) })
                }}
              />
            </div>
            <Segmented
              legend="Units"
              value={unit}
              options={UNITS}
              onChange={(next) => {
                onSettings({ unit: next })
              }}
            />
          </div>
        </div>
      </div>
    </>
  )
}
