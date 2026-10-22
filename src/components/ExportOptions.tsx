import { useId, useRef, useState } from 'react'
import { QUALITY_PRESETS } from '../core/compression'
import type { NumberPosition, Quality, Settings } from '../core/model'
import { formatBytes } from '../core/units'
import { Button } from './controls'
import { cx } from './cx'
import type { ExportState } from './DocumentBar'
import { DownloadIcon, LockIcon } from './Icons'
import { NumberField } from './NumberField'
import { POPOVER_PANEL, POPOVER_WIDTH, closeOwnPopover, useCloseOnFocusOut } from './popover'
import { TOOLBAR_ITEM } from './toolbarItem'

const OPTIONS: readonly { value: Quality; label: string; hint: string }[] = [
  {
    value: 'original',
    label: 'Original',
    hint: 'Images go in as they are, unless a filter, crop or Fill changes them — best quality, largest file',
  },
  ...(['high', 'balanced', 'small'] as const).map((value) => ({
    value,
    label: QUALITY_PRESETS[value].label,
    hint: QUALITY_PRESETS[value].hint,
  })),
]

const MB = 1024 * 1024

/** "1 page", "3 pages". */
const pages = (n: number) => `${String(n)} ${n === 1 ? 'page' : 'pages'}`

/** What the export is doing, for the button while it runs. */
const progress = (exporting: ExportState) =>
  exporting.phase === 'ocr'
    ? `Reading text ${String(exporting.done + 1)}/${String(exporting.total)}…`
    : (exporting.attempt ?? 1) > 1
      ? `Shrinking, try ${String(exporting.attempt)} · ${String(exporting.done)}/${String(exporting.total)}…`
      : `Building ${String(exporting.done)}/${String(exporting.total)}…`

/**
 * Export, in one place (#49): the toolbar button says what will be exported
 * and opens everything about the file — its title and name, image quality,
 * an optional size ceiling, OCR, page numbers and a password — with the
 * estimate and the Export button pinned at the foot, in view however far the
 * options scroll. A native popover (top layer, light dismiss, Escape to
 * close, focus returned to the trigger — all from the platform, no script).
 */
export const ExportOptions = ({
  settings,
  pageCount,
  exporting,
  estimate,
  lastExport,
  onSettings,
  onExport,
  canExport,
  password,
  onPassword,
  passwordError = null,
  panelId: givenPanelId,
}: {
  settings: Pick<Settings, 'title' | 'quality' | 'maxBytes' | 'pageNumbers' | 'ocr'>
  pageCount: number
  exporting: ExportState
  /** Estimated bytes for the current pages and quality. */
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  onSettings: (patch: Partial<Settings>) => void
  onExport: () => void
  canExport: boolean
  /** Held in memory for this visit only — never saved. */
  password: string
  onPassword: (password: string) => void
  /** Why the password can't be used, shown under the field. */
  passwordError?: string | null
  /** The panel's id; `${panelId}-password` is the password field's. */
  panelId?: string
}) => {
  const id = useId()
  const panelId = givenPanelId ?? `${id}-export-options`
  const passwordId = `${panelId}-password`
  const [showPassword, setShowPassword] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  useCloseOnFocusOut(panel, panelId)
  const locked = password !== ''

  return (
    <>
      <button
        type="button"
        popoverTarget={panelId}
        {...TOOLBAR_ITEM}
        // Stays focusable while busy (it only opens the options), so focus
        // isn't dropped mid-export; the progress shows here.
        aria-busy={exporting.busy || undefined}
        className="anchor-export inline-flex h-9 items-center gap-2 rounded-[2px] border border-transparent bg-ink px-3.5 text-sm font-medium whitespace-nowrap text-paper hover:bg-ink/85"
      >
        {locked ? <LockIcon width={16} height={16} /> : <DownloadIcon width={16} height={16} />}
        {/* The accessible name starts with the visible text (WCAG 2.5.3). */}
        {exporting.busy ? (
          <span className="tabular-nums">{progress(exporting)}</span>
        ) : (
          <span>Export · {pages(pageCount)}</span>
        )}
        <span className="sr-only">{locked ? ', locked with a password' : ''}, options</span>
      </button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        ref={panel}
        className={cx(POPOVER_PANEL, POPOVER_WIDTH, 'popover-end from-export')}
      >
        {/* The panel's height limit, passed down so the options scroll and
            the foot stays put. */}
        <div className="flex max-h-[inherit] flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <h2 id={`${id}-title`} className="font-display text-2xl">
              Export options
            </h2>

            <div className="mt-4">
              <label htmlFor={`${id}-doc-title`} className="label mb-2 block text-ink-faint">
                Title &amp; filename
              </label>
              <input
                id={`${id}-doc-title`}
                className="field w-full"
                placeholder="Untitled scans"
                value={settings.title}
                maxLength={120}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-doc-title-hint`}
                onChange={(event) => {
                  onSettings({ title: event.target.value })
                }}
              />
              <p id={`${id}-doc-title-hint`} className="mt-1.5 text-xs text-ink-muted">
                Optional. Shown by PDF readers, and names the file.
              </p>
            </div>

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
                Keep the file under <span className="sr-only">(megabytes)</span>
              </label>
              <div className="flex items-center gap-3">
                <NumberField
                  id={`${id}-max`}
                  className="w-28"
                  value={
                    settings.maxBytes === null
                      ? null
                      : Math.round((settings.maxBytes / MB) * 10) / 10
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

            <div className="mt-5 border-t border-rule pt-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--c-ink)]"
                  checked={settings.ocr}
                  aria-describedby={`${id}-ocr-hint`}
                  onChange={(event) => {
                    onSettings({ ocr: event.target.checked })
                  }}
                />
                Make text searchable (OCR)
              </label>
              <p id={`${id}-ocr-hint`} className="mt-1 ml-6 text-xs text-ink-muted">
                English. Recognised on this device — nothing is uploaded. The text is added to the
                PDF invisibly, so anyone with the file can search and copy it. The first time, it
                downloads about 4 MB; then a few seconds per page.
              </p>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--c-ink)]"
                  checked={settings.pageNumbers.show}
                  onChange={(event) => {
                    onSettings({
                      pageNumbers: { ...settings.pageNumbers, show: event.target.checked },
                    })
                  }}
                />
                Page numbers
              </label>
              {settings.pageNumbers.show && (
                <div
                  className="mt-3 flex items-end gap-3"
                  role="group"
                  aria-label="Page number options"
                >
                  <div className="flex-1">
                    <label htmlFor={`${id}-numpos`} className="label mb-2 block text-ink-faint">
                      Position
                    </label>
                    <select
                      id={`${id}-numpos`}
                      className="field w-full"
                      value={settings.pageNumbers.position}
                      onChange={(event) => {
                        onSettings({
                          pageNumbers: {
                            ...settings.pageNumbers,
                            position: event.target.value as NumberPosition,
                          },
                        })
                      }}
                    >
                      <option value="bottom-center">Bottom centre</option>
                      <option value="bottom-right">Bottom right</option>
                      <option value="top-right">Top right</option>
                    </select>
                  </div>
                  <div className="w-24">
                    <label htmlFor={`${id}-numstart`} className="label mb-2 block text-ink-faint">
                      Start at
                    </label>
                    <NumberField
                      id={`${id}-numstart`}
                      value={settings.pageNumbers.start}
                      min={0}
                      max={9999}
                      onCommit={(start) => {
                        onSettings({
                          pageNumbers: { ...settings.pageNumbers, start: Math.round(start) },
                        })
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label htmlFor={passwordId} className="label mb-2 block text-ink-faint">
                Password to open
              </label>
              <div className="flex gap-2">
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  className="field min-w-0 flex-1"
                  value={password}
                  // Not saved anywhere, so don't invite a password manager to save
                  // or generate one.
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                  spellCheck={false}
                  autoCapitalize="off"
                  placeholder="None"
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={cx(
                    passwordError && `${passwordId}-error`,
                    `${passwordId}-hint`,
                  )}
                  onChange={(event) => {
                    onPassword(event.target.value)
                  }}
                />
                <Button
                  aria-pressed={showPassword}
                  aria-controls={passwordId}
                  onClick={() => {
                    setShowPassword((shown) => !shown)
                  }}
                >
                  Show <span className="sr-only">password</span>
                </Button>
              </div>
              {passwordError && (
                <p id={`${passwordId}-error`} className="mt-1.5 text-xs text-accent">
                  {passwordError}
                </p>
              )}
              <p id={`${passwordId}-hint`} className="mt-1.5 text-xs text-ink-muted">
                Optional. Encrypts the PDF’s contents (AES-256); the file’s name (from the title)
                and its number of pages aren’t hidden. Not saved anywhere — if you lose it, the file
                can’t be opened.
              </p>
            </div>
          </div>
          <div className="border-t border-rule bg-paper px-5 pt-3 pb-4">
            <dl className="text-sm">
              <div className="flex justify-between gap-4 py-0.5">
                <dt className="text-ink-muted">Estimated size</dt>
                <dd className="tabular-nums">≈ {formatBytes(estimate)}</dd>
              </div>
              {lastExport && (
                <div className="flex justify-between gap-4 py-0.5">
                  <dt className="text-ink-muted">Last export</dt>
                  <dd className={cx('tabular-nums', !lastExport.fits && 'text-accent')}>
                    {lastExport.size} · {lastExport.used}
                  </dd>
                </div>
              )}
            </dl>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={!canExport || Boolean(passwordError)}
              {...(passwordError ? { 'aria-describedby': `${passwordId}-error` } : {})}
              onClick={(event) => {
                closeOwnPopover(event.currentTarget)
                onExport()
              }}
            >
              {locked ? (
                <LockIcon width={16} height={16} />
              ) : (
                <DownloadIcon width={16} height={16} />
              )}
              {locked ? 'Export locked PDF' : 'Export PDF'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
