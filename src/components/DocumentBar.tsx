import { useId } from 'react'
import type { Orientation, PageSizeId, Settings, Unit } from '../core/model'
import { PAGE_SIZES } from '../core/pageSizes'
import { PAGE_MAX, PAGE_MIN } from '../core/reducer'
import { fromPoints, roundForUnit, toPoints } from '../core/units'
import { Button, FieldLabel, IconButton, Segmented } from './controls'
import {
  DownloadIcon,
  PlusIcon,
  RedoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  UndoIcon,
} from './Icons'
import { ExportOptions } from './ExportOptions'
import { NumberField } from './NumberField'

const ORIENTATIONS: readonly { value: Orientation; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

const UNITS: readonly { value: Unit; label: string }[] = [
  { value: 'mm', label: 'mm' },
  { value: 'in', label: 'in' },
]

export interface ExportState {
  busy: boolean
  done: number
  total: number
  /** Above 1 when a size limit forced a retry at lower quality. */
  attempt?: number
  /** Reading text before the build. */
  phase?: 'ocr'
}

/**
 * Document-wide settings and actions: page size, orientation, margins, title,
 * history, add and export. Sticky above the pages.
 */
export const DocumentBar = ({
  settings,
  pageCount,
  canUndo,
  canRedo,
  exporting,
  onSettings,
  onUndo,
  onRedo,
  onRotateAll,
  onAdd,
  onExport,
  estimate,
  lastExport,
  password,
  onPassword,
}: {
  settings: Settings
  pageCount: number
  canUndo: boolean
  canRedo: boolean
  exporting: ExportState
  onSettings: (patch: Partial<Settings>) => void
  onUndo: () => void
  onRedo: () => void
  onRotateAll: (by: -1 | 1) => void
  onAdd: () => void
  onExport: () => void
  estimate: number
  lastExport: { size: string; used: string; fits: boolean } | null
  password: string
  onPassword: (password: string) => void
}) => {
  const id = useId()
  const { unit } = settings
  const inUnit = (points: number) => roundForUnit(fromPoints(points, unit), unit)
  const step = unit === 'in' ? 0.05 : 1
  const limits = { min: inUnit(PAGE_MIN), max: inUnit(PAGE_MAX) }
  const mod =
    typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘' : 'Ctrl+'

  return (
    <div className="z-20 border-b border-rule bg-paper/92 backdrop-blur-md lg:sticky lg:top-0">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-end gap-x-6 gap-y-4 px-4 py-4 sm:px-6">
        <div className="w-40">
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
          <div className="w-28">
            <FieldLabel htmlFor={`${id}-dpi`}>Image dpi</FieldLabel>
            <NumberField
              id={`${id}-dpi`}
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
            <p id={`${id}-dpi-hint`} className="sr-only">
              Each page is sized to its image at this resolution. PDF pages keep their own size.
            </p>
          </div>
        )}

        {settings.size === 'custom' && (
          <fieldset className="flex items-end gap-2">
            <legend className="label mb-2 text-ink-faint">Custom size</legend>
            <NumberField
              id={`${id}-w`}
              className="w-24"
              aria-label={`Width in ${unit === 'in' ? 'inches' : 'millimetres'}`}
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
              className="w-24"
              aria-label={`Height in ${unit === 'in' ? 'inches' : 'millimetres'}`}
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

        <div className="w-24">
          <FieldLabel htmlFor={`${id}-margin`}>Margin</FieldLabel>
          <NumberField
            id={`${id}-margin`}
            value={inUnit(settings.margin)}
            min={0}
            max={unit === 'in' ? 4 : 100}
            step={unit === 'in' ? 0.05 : 1}
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

        <div className="min-w-44 flex-1 sm:max-w-72">
          <FieldLabel htmlFor={`${id}-title`}>Title &amp; filename</FieldLabel>
          <input
            id={`${id}-title`}
            className="field w-full"
            placeholder="Untitled scans"
            value={settings.title}
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              onSettings({ title: event.target.value })
            }}
          />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div className="mr-1 flex items-center" role="group" aria-label="Rotate all pages">
            <IconButton
              label="Rotate all pages left"
              disabled={pageCount === 0}
              onClick={() => {
                onRotateAll(-1)
              }}
            >
              <RotateLeftIcon />
            </IconButton>
            <IconButton
              label="Rotate all pages right"
              disabled={pageCount === 0}
              onClick={() => {
                onRotateAll(1)
              }}
            >
              <RotateRightIcon />
            </IconButton>
          </div>
          <div
            className="mr-1 flex items-center border-l border-rule pl-1.5"
            role="group"
            aria-label="History"
          >
            <IconButton label={`Undo (${mod}Z)`} disabled={!canUndo} onClick={onUndo}>
              <UndoIcon />
            </IconButton>
            <IconButton label={`Redo (${mod}Shift+Z)`} disabled={!canRedo} onClick={onRedo}>
              <RedoIcon />
            </IconButton>
          </div>
          <Button onClick={onAdd}>
            <PlusIcon width={16} height={16} />
            Add pages
          </Button>
          <ExportOptions
            settings={settings}
            estimate={estimate}
            lastExport={lastExport}
            onSettings={onSettings}
            onExport={onExport}
            canExport={pageCount > 0 && !exporting.busy}
            password={password}
            onPassword={onPassword}
          />
          <Button variant="primary" disabled={pageCount === 0 || exporting.busy} onClick={onExport}>
            <DownloadIcon width={16} height={16} />
            {exporting.busy
              ? exporting.phase === 'ocr'
                ? `Reading text ${exporting.done + 1}/${exporting.total}…`
                : (exporting.attempt ?? 1) > 1
                  ? `Shrinking, try ${exporting.attempt} · ${exporting.done}/${exporting.total}…`
                  : `Building ${exporting.done}/${exporting.total}…`
              : `Export PDF · ${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
