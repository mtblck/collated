import { useId } from 'react'
import { QUALITY_PRESETS } from '../core/compression'
import type { Quality, Settings } from '../core/model'
import { formatBytes } from '../core/units'
import { Button } from './controls'
import { cx } from './cx'
import { DownloadIcon } from './Icons'
import { NumberField } from './NumberField'

const OPTIONS: readonly { value: Quality; label: string; hint: string }[] = [
  {
    value: 'original',
    label: 'Original',
    hint: 'Images go in untouched — best quality, largest file',
  },
  ...(['high', 'balanced', 'small'] as const).map((value) => ({
    value,
    label: QUALITY_PRESETS[value].label,
    hint: QUALITY_PRESETS[value].hint,
  })),
]

const MB = 1024 * 1024

/**
 * Image quality and an optional size ceiling for the export, in a native
 * popover (top layer, light dismiss, Escape to close, focus returned to the
 * trigger — all from the platform, no script).
 */
export const ExportOptions = ({
  settings,
  estimate,
  lastExport,
  onSettings,
  onExport,
  canExport,
}: {
  settings: Pick<Settings, 'quality' | 'maxBytes'>
  /** Estimated bytes for the current pages and quality. */
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  onSettings: (patch: Partial<Settings>) => void
  onExport: () => void
  canExport: boolean
}) => {
  const id = useId()
  const panelId = `${id}-export-options`
  const current = OPTIONS.find((o) => o.value === settings.quality)?.label ?? 'Original'

  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        className="flex h-9 flex-col items-start justify-center rounded-[2px] border border-rule bg-paper px-3 text-left hover:border-ink-faint"
      >
        {/* The accessible name contains the visible text (WCAG 2.5.3), so
            voice control users can say what they see. */}
        <span className="sr-only">Export options: </span>
        <span className="label text-[0.625rem] leading-none text-ink-faint">{current}</span>
        <span className="mt-0.5 text-xs leading-none text-ink tabular-nums">
          ≈ {formatBytes(estimate)}
        </span>
      </button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        className={cx(
          'm-0 w-[min(22rem,calc(100vw-2rem))] border border-rule bg-paper p-5 text-ink shadow-xl',
          'fixed inset-auto right-4 bottom-4 lg:top-24 lg:right-6 lg:bottom-auto',
        )}
      >
        <h2 id={`${id}-title`} className="font-display text-2xl">
          Export options
        </h2>

        <fieldset className="mt-4">
          <legend className="label mb-2 text-ink-faint">Image quality</legend>
          <div className="flex flex-col gap-1">
            {OPTIONS.map((option) => (
              <label
                key={option.value}
                className={cx(
                  'flex cursor-pointer gap-3 rounded-[2px] border px-3 py-2',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                  settings.quality === option.value
                    ? 'border-ink bg-ink/[0.04]'
                    : 'border-transparent hover:bg-ink/[0.03]',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-quality`}
                  className="mt-1 accent-[var(--c-ink)]"
                  value={option.value}
                  checked={settings.quality === option.value}
                  onChange={() => {
                    onSettings({ quality: option.value })
                  }}
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-ink-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-4">
          <label htmlFor={`${id}-max`} className="label mb-2 block text-ink-faint">
            Keep the file under
          </label>
          <div className="flex items-center gap-3">
            <NumberField
              id={`${id}-max`}
              className="w-28"
              value={
                settings.maxBytes === null ? null : Math.round((settings.maxBytes / MB) * 10) / 10
              }
              min={0}
              max={2000}
              step={0.5}
              suffix="MB"
              aria-describedby={`${id}-max-hint`}
              onCommit={(value) => {
                onSettings({ maxBytes: value > 0 ? Math.round(value * MB) : null })
              }}
              onClear={() => {
                onSettings({ maxBytes: null })
              }}
            />
            <p id={`${id}-max-hint`} className="text-xs text-ink-muted">
              Optional. Leave empty for no limit; lower quality is tried until it fits.
            </p>
          </div>
        </div>

        <dl className="mt-5 border-t border-rule pt-3 text-sm">
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-ink-muted">Estimated size</dt>
            <dd className="tabular-nums">≈ {formatBytes(estimate)}</dd>
          </div>
          {lastExport && (
            <div className="flex justify-between gap-4 py-1">
              <dt className="text-ink-muted">Last export</dt>
              <dd className={cx('tabular-nums', !lastExport.fits && 'text-accent')}>
                {lastExport.size} · {lastExport.used}
              </dd>
            </div>
          )}
        </dl>

        <Button
          variant="primary"
          className="mt-4 w-full"
          disabled={!canExport}
          onClick={(event) => {
            event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
            onExport()
          }}
        >
          <DownloadIcon width={16} height={16} />
          Export PDF
        </Button>
      </div>
    </>
  )
}
