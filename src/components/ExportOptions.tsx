import { useId, useRef, useState } from 'react'
import { QUALITY_PRESETS } from '../core/compression'
import type {
  NumberPosition,
  Quality,
  Settings,
  Watermark,
  WatermarkPosition,
  WatermarkSize,
} from '../core/model'
import { describePlan, type Plan, type SplitMode, type SplitOptions } from '../core/split'
import { formatBytes } from '../core/units'
import { WATERMARK_OPACITY_MIN, unsupportedCharacters } from '../core/watermark'
import { Button } from './controls'
import { cx } from './cx'
import type { ExportState } from './DocumentBar'
import { DownloadIcon, LockIcon } from './Icons'
import { NumberField } from './NumberField'
import { POPOVER_FRAME, POPOVER_WIDTH, closeOwnPopover, useCloseOnFocusOut } from './popover'
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

const MODES: readonly { value: SplitMode; label: string }[] = [
  { value: 'all', label: 'All pages' },
  { value: 'selection', label: 'Selected pages' },
  { value: 'ranges', label: 'Split by page ranges' },
  { value: 'every', label: 'Split every few pages' },
]

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
  split,
  onSplit,
  selectedCount,
  selectedIds = [],
  plan,
  panelId: givenPanelId,
}: {
  settings: Pick<
    Settings,
    'title' | 'quality' | 'maxBytes' | 'pageNumbers' | 'watermark' | 'ocr' | 'bookmarkFiles'
  >
  pageCount: number
  exporting: ExportState
  /** Estimated bytes for the current pages and quality. */
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  /** `coalesce` makes a run of changes (typing, a slider) one undo step. */
  onSettings: (patch: Partial<Settings>, coalesce?: string) => void
  onExport: () => void
  canExport: boolean
  /** Held in memory for this visit only — never saved. */
  password: string
  onPassword: (password: string) => void
  /** Why the password can't be used, shown under the field. */
  passwordError?: string | null
  /** Which pages, into how many files (#66). */
  split: SplitOptions
  onSplit: (patch: Partial<SplitOptions>) => void
  selectedCount: number
  /** The selected pages, for a watermark on just those. */
  selectedIds?: readonly string[]
  /** The files the export will make, or why it can't. */
  plan: Plan
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
  const planId = `${panelId}-plan`
  const planError = 'error' in plan ? plan.error : null
  const summary = describePlan(plan, split.mode)
  const files = 'parts' in plan ? plan.parts.length : 1
  const [only] = 'parts' in plan && files === 1 ? plan.parts : []
  const splitting = split.mode === 'ranges' || split.mode === 'every'
  const watermark = settings.watermark
  const setWatermark = (patch: Partial<Watermark>, coalesce?: string) => {
    onSettings({ watermark: { ...watermark, ...patch } }, coalesce)
  }
  const missing = unsupportedCharacters(watermark.text)
  const chosen = watermark.pageIds
  /** The selection differs from the pages the watermark is on. */
  const newSelection =
    chosen !== null &&
    selectedIds.length > 0 &&
    (selectedIds.length !== chosen.length || selectedIds.some((p) => !chosen.includes(p)))
  /** The field to fix when the plan can't be made. */
  const planField = () =>
    document.getElementById(
      split.mode === 'ranges'
        ? `${id}-ranges`
        : split.mode === 'every'
          ? `${id}-every`
          : `${id}-mode-${split.mode}`,
    )

  return (
    <>
      {/* Stays a working button while busy (it only opens the options), so
          focus isn't dropped mid-export; the progress shows here, and the
          status line announces it. */}
      <Button variant="primary" popoverTarget={panelId} {...TOOLBAR_ITEM} className="anchor-export">
        {locked ? <LockIcon width={16} height={16} /> : <DownloadIcon width={16} height={16} />}
        {/* The accessible name starts with the visible text (WCAG 2.5.3). */}
        {exporting.busy ? (
          <>
            <span className="hidden tabular-nums sm:inline">{progress(exporting)}</span>
            {/* Phones: just the count, so the toolbar keeps its two rows. */}
            <span className="tabular-nums sm:hidden">
              {String(exporting.done)}/{String(exporting.total)}…
            </span>
          </>
        ) : (
          <span>
            Export ·{' '}
            {files > 1 ? `${String(files)} files` : pages(only?.pageIds.length ?? pageCount)}
          </span>
        )}
        <span className="sr-only">{locked ? ', locked with a password' : ''}, options</span>
      </Button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-labelledby={`${id}-title`}
        ref={panel}
        className={cx(POPOVER_FRAME, POPOVER_WIDTH, 'popover-end from-export')}
      >
        {/* The panel's height limit, passed down (with the border, so the
            two match exactly): only the options scroll, the foot stays put. */}
        <div className="flex max-h-[inherit] flex-col border border-rule">
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
            <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
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

            <fieldset className="mt-4" aria-describedby={summary ? planId : undefined}>
              <legend className="label mb-2 text-ink-faint">Pages</legend>
              <div className="flex flex-col gap-1">
                {MODES.map((mode) => (
                  <label
                    key={mode.value}
                    className={cx(
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-1.5 text-sm',
                      'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                      split.mode === mode.value
                        ? 'border-ink bg-ink/[0.04]'
                        : 'border-transparent hover:bg-ink/[0.03]',
                    )}
                  >
                    <input
                      type="radio"
                      id={`${id}-mode-${mode.value}`}
                      name={`${id}-mode`}
                      className="accent-[var(--c-ink)]"
                      value={mode.value}
                      checked={split.mode === mode.value}
                      onChange={() => {
                        onSplit({ mode: mode.value })
                      }}
                    />
                    <span>
                      {mode.label}
                      {mode.value === 'selection' && (
                        <span className="text-ink-muted"> ({String(selectedCount)})</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
              {split.mode === 'ranges' && (
                <div className="mt-2">
                  <label htmlFor={`${id}-ranges`} className="sr-only">
                    Page ranges
                  </label>
                  <input
                    id={`${id}-ranges`}
                    className="field w-full"
                    placeholder="1-3, 4-10, 11-"
                    value={split.ranges}
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    aria-invalid={planError ? true : undefined}
                    aria-describedby={planId}
                    onChange={(event) => {
                      onSplit({ ranges: event.target.value })
                    }}
                  />
                </div>
              )}
              {split.mode === 'every' && (
                <div className="mt-2 flex items-center gap-3">
                  <label htmlFor={`${id}-every`} className="text-sm">
                    Every
                  </label>
                  <NumberField
                    id={`${id}-every`}
                    className="w-24"
                    value={split.every}
                    min={1}
                    max={Math.max(1, pageCount)}
                    suffix={split.every === 1 ? 'page' : 'pages'}
                    aria-describedby={planId}
                    onCommit={(every) => {
                      onSplit({ every: Math.round(every) })
                    }}
                  />
                </div>
              )}
              {/* Always there, so changes are announced as the ranges are typed. */}
              <p
                id={planId}
                role="status"
                className={cx(
                  'text-xs',
                  summary && 'mt-1.5',
                  planError ? 'text-accent' : 'text-ink-muted',
                )}
              >
                {summary}
              </p>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="label mb-2 text-ink-faint">Image quality</legend>
              <div className="flex flex-col gap-1">
                {OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={cx(
                      'flex cursor-pointer gap-3 rounded-xl border px-3 py-2',
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
                  Optional. Leave empty for no limit; lower quality is tried until it fits
                  {splitting ? ' (each file on its own)' : ''}.
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
              {settings.pageNumbers.show && splitting && (
                <div className="mt-3">
                  <label htmlFor={`${id}-numbering`} className="label mb-2 block text-ink-faint">
                    In each file
                  </label>
                  <select
                    id={`${id}-numbering`}
                    className="field w-full"
                    value={split.numbering}
                    onChange={(event) => {
                      onSplit({ numbering: event.target.value as SplitOptions['numbering'] })
                    }}
                  >
                    <option value="restart">Start again</option>
                    <option value="continue">Carry on from the file before</option>
                  </select>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--c-ink)]"
                  checked={settings.bookmarkFiles}
                  aria-describedby={`${id}-bookmarks-hint`}
                  onChange={(event) => {
                    onSettings({ bookmarkFiles: event.target.checked })
                  }}
                />
                Bookmark each imported file
              </label>
              <p id={`${id}-bookmarks-hint`} className="mt-1 ml-6 text-xs text-ink-muted">
                Named after the file, at its first page. Sections you name in a page’s settings are
                always bookmarked
                {splitting ? ', and each file opens under the section it starts in' : ''}.
              </p>
            </div>

            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--c-ink)]"
                  checked={watermark.show}
                  onChange={(event) => {
                    setWatermark({ show: event.target.checked })
                  }}
                />
                Watermark
              </label>
              {watermark.show && (
                <div
                  className="mt-3 flex flex-col gap-3"
                  role="group"
                  aria-label="Watermark options"
                >
                  <div>
                    <label htmlFor={`${id}-wm-text`} className="label mb-2 block text-ink-faint">
                      Text
                    </label>
                    <div className="flex gap-2">
                      <input
                        id={`${id}-wm-text`}
                        className="field min-w-0 flex-1"
                        placeholder="Copy for Acme Bank only"
                        value={watermark.text}
                        maxLength={120}
                        autoComplete="off"
                        aria-invalid={missing.length && !watermark.flatten ? true : undefined}
                        aria-describedby={`${id}-wm-hint`}
                        onChange={(event) => {
                          setWatermark({ text: event.target.value }, 'watermark-text')
                        }}
                      />
                      <Button
                        onClick={() => {
                          const today = new Date().toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                          const text = watermark.text.trimEnd()
                          setWatermark({ text: text ? `${text} · ${today}` : today })
                        }}
                      >
                        Add date
                      </Button>
                    </div>
                    <p
                      id={`${id}-wm-hint`}
                      className={cx(
                        'mt-1.5 text-xs',
                        missing.length ? 'text-accent' : 'text-ink-muted',
                      )}
                    >
                      {missing.length
                        ? `The PDF’s font has no ${missing.join(' ')}: ${watermark.flatten ? 'only image pages can show it' : 'use Latin letters, or burn it in below'}.`
                        : 'Say who the copy is for, so it can’t be reused for anything else.'}
                    </p>
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label htmlFor={`${id}-wm-pos`} className="label mb-2 block text-ink-faint">
                        Position
                      </label>
                      <select
                        id={`${id}-wm-pos`}
                        className="field w-full"
                        value={watermark.position}
                        onChange={(event) => {
                          setWatermark({ position: event.target.value as WatermarkPosition })
                        }}
                      >
                        <option value="diagonal">Across the page</option>
                        <option value="footer">Along the foot</option>
                      </select>
                    </div>
                    <div className="w-28">
                      <label htmlFor={`${id}-wm-size`} className="label mb-2 block text-ink-faint">
                        Size
                      </label>
                      <select
                        id={`${id}-wm-size`}
                        className="field w-full"
                        value={watermark.size}
                        onChange={(event) => {
                          setWatermark({ size: event.target.value as WatermarkSize })
                        }}
                      >
                        <option value="small">Small</option>
                        <option value="medium">Medium</option>
                        <option value="large">Large</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label htmlFor={`${id}-wm-colour`} className="text-sm">
                      Colour
                    </label>
                    <input
                      id={`${id}-wm-colour`}
                      type="color"
                      className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-rule bg-paper p-0.5"
                      value={watermark.colour}
                      onChange={(event) => {
                        setWatermark({ colour: event.target.value }, 'watermark-colour')
                      }}
                    />
                    <label htmlFor={`${id}-wm-opacity`} className="ml-2 text-sm">
                      Opacity
                    </label>
                    <input
                      id={`${id}-wm-opacity`}
                      type="range"
                      className="range min-w-0 flex-1"
                      min={WATERMARK_OPACITY_MIN * 100}
                      max={100}
                      step={5}
                      value={Math.round(watermark.opacity * 100)}
                      aria-valuetext={`${String(Math.round(watermark.opacity * 100))}%`}
                      onChange={(event) => {
                        setWatermark(
                          { opacity: Number(event.target.value) / 100 },
                          'watermark-opacity',
                        )
                      }}
                    />
                    <span className="w-10 text-right text-sm tabular-nums" aria-hidden="true">
                      {Math.round(watermark.opacity * 100)}%
                    </span>
                  </div>
                  <fieldset>
                    <legend className="label mb-2 text-ink-faint">On</legend>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`${id}-wm-pages`}
                          className="accent-[var(--c-ink)]"
                          checked={chosen === null}
                          onChange={() => {
                            setWatermark({ pageIds: null })
                          }}
                        />
                        All pages
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`${id}-wm-pages`}
                          className="accent-[var(--c-ink)]"
                          checked={chosen !== null}
                          disabled={chosen === null && selectedIds.length === 0}
                          aria-describedby={`${id}-wm-pages-hint`}
                          onChange={() => {
                            setWatermark({ pageIds: [...selectedIds] })
                          }}
                        />
                        {chosen === null
                          ? `Selected pages (${String(selectedIds.length)})`
                          : `${pages(chosen.length)} chosen`}
                      </label>
                      {newSelection && (
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => {
                            setWatermark({ pageIds: [...selectedIds] })
                          }}
                        >
                          Use the {String(selectedIds.length)} selected
                        </Button>
                      )}
                    </div>
                    <p id={`${id}-wm-pages-hint`} className="mt-1 text-xs text-ink-muted">
                      {chosen === null
                        ? 'Select pages first to put it on just those.'
                        : 'The pages selected when you chose this; the others stay clean.'}
                    </p>
                  </fieldset>
                  <div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-[var(--c-ink)]"
                        checked={watermark.flatten}
                        aria-describedby={`${id}-wm-flatten-hint`}
                        onChange={(event) => {
                          setWatermark({ flatten: event.target.checked })
                        }}
                      />
                      Burn into image pages
                    </label>
                    <p id={`${id}-wm-flatten-hint`} className="mt-1 ml-6 text-xs text-ink-muted">
                      Each photo or scan page becomes one picture with the watermark in it, so it
                      can’t be lifted off. Larger files; PDF pages keep it as text.
                    </p>
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
              // Inactive, not disabled: it stays reachable, and with a password
              // problem it says why and takes you to the field.
              inactive={!canExport}
              {...(planError
                ? { 'aria-describedby': planId }
                : passwordError
                  ? { 'aria-describedby': `${passwordId}-error` }
                  : {})}
              onClick={(event) => {
                if (planError) {
                  planField()?.focus()
                  return
                }
                if (passwordError) {
                  document.getElementById(passwordId)?.focus()
                  return
                }
                closeOwnPopover(event.currentTarget)
                onExport()
              }}
            >
              {locked ? (
                <LockIcon width={16} height={16} />
              ) : (
                <DownloadIcon width={16} height={16} />
              )}
              {files > 1
                ? `Export ${String(files)} ${locked ? 'locked ' : ''}PDFs`
                : locked
                  ? 'Export locked PDF'
                  : 'Export PDF'}
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
