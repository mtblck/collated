import { useId, type ReactNode } from 'react'
import type { Asset, Filter, FitMode, Page, PageTransform } from '../core/model'
import { ANGLE_LIMIT, DEFAULT_TRANSFORM, SCALE_MAX, SCALE_MIN, isVector } from '../core/model'
import { Button, IconButton, Segmented } from './controls'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ResetIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TrashIcon,
} from './Icons'
import { pageNumber } from './format'

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'grey', label: 'Greyscale' },
  { value: 'bw', label: 'B&W' },
]

const FITS: readonly { value: FitMode; label: string }[] = [
  { value: 'contain', label: 'Fit' },
  { value: 'cover', label: 'Fill' },
]

export interface GroupActions {
  /** Applied to every selected page (filters to image pages only), as one undo step. */
  onTransform: (patch: Partial<PageTransform>, gesture?: string) => void
  onGestureEnd: () => void
  onRotate: (by: -1 | 1) => void
  onShift: (by: -1 | 1) => void
  onAutoStraighten: () => void
  onDuplicate: () => void
  onReset: () => void
  onRemove: () => void
  onClear: () => void
}

/** The one value every page shares, else null (shown as "Mixed"). */
const shared = <T,>(values: readonly T[]): T | null => {
  const [first] = values
  return first !== undefined && values.every((v) => v === first) ? first : null
}

/** "01, 02, 05" or "01–04": the selected pages' numbers, for the heading. */
const pageList = (indices: readonly number[]): string => {
  const runs: [number, number][] = []
  for (const i of indices) {
    const last = runs.at(-1)
    if (last && i === last[1] + 1) last[1] = i
    else runs.push([i, i])
  }
  return runs
    .map(([a, b]) => (a === b ? pageNumber(a) : `${pageNumber(a)}–${pageNumber(b)}`))
    .join(', ')
}

const Field = ({
  id,
  label,
  value,
  children,
}: {
  id: string
  label: string
  value: string
  children: ReactNode
}) => (
  <div>
    <div className="mb-1 flex items-baseline justify-between">
      <label htmlFor={id} className="label text-ink-faint">
        {label}
      </label>
      <output htmlFor={id} className="text-sm text-ink tabular-nums">
        {value}
      </output>
    </div>
    {children}
  </div>
)

/**
 * Edits several selected pages together (#65): the settings that make
 * sense for a group. Each change is one undo step for all of them.
 */
export const GroupInspector = ({
  pages,
  assets,
  indices,
  count,
  actions,
  straightening = false,
}: {
  pages: readonly Page[]
  assets: Record<string, Asset>
  /** The selected pages' positions in the document, ascending. */
  indices: readonly number[]
  count: number
  actions: GroupActions
  straightening?: boolean
}) => {
  const id = useId()
  const n = pages.length
  const images = pages.filter((p) => {
    const asset = assets[p.assetId]
    return asset ? !isVector(asset) : false
  })
  const angle = shared(pages.map((p) => p.angle))
  const scale = shared(pages.map((p) => p.scale))
  const fit = shared(pages.map((p) => p.fit))
  const filter = shared(images.map((p) => p.filter))
  const percent = scale === null ? null : Math.round(scale * 100)
  const changed = pages.some((p) =>
    (Object.keys(DEFAULT_TRANSFORM) as (keyof PageTransform)[]).some(
      (key) => p[key] !== DEFAULT_TRANSFORM[key],
    ),
  )
  // A group moves while any selected page has an unselected page beside it.
  const canEarlier = indices.some((i, k) => i > k)
  const canLater = indices.some((i, k) => i < count - n + k)
  const gesture = (name: string) => `${name}:${pages.map((p) => p.id).join(',')}`

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-6">
      <header>
        <p className="label text-ink-faint">
          Pages {pageList(indices)} <span aria-hidden="true">/</span>
          <span className="sr-only">of</span> {pageNumber(count - 1)}
        </p>
        <h2
          id={`${id}-heading`}
          className="mt-2 text-xl leading-tight font-semibold tracking-tight text-ink"
        >
          {n} pages selected
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Changes here apply to every selected page. Shift-click adds a range, ⌘ or Ctrl-click one
          page; Escape clears.
        </p>
        <Button size="sm" variant="quiet" className="mt-2 -ml-3" onClick={actions.onClear}>
          Clear selection
        </Button>
      </header>

      <div>
        <p className="label mb-2 text-ink-faint" id={`${id}-rotate`}>
          Rotate
        </p>
        <div className="flex gap-2" role="group" aria-labelledby={`${id}-rotate`}>
          <Button
            className="flex-1"
            onClick={() => {
              actions.onRotate(-1)
            }}
          >
            <RotateLeftIcon width={16} height={16} /> Left
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              actions.onRotate(1)
            }}
          >
            <RotateRightIcon width={16} height={16} /> Right
          </Button>
        </div>
      </div>

      <div>
        <Field
          id={`${id}-angle`}
          label="Straighten"
          value={angle === null ? 'Mixed' : `${angle > 0 ? '+' : ''}${angle.toFixed(1)}°`}
        >
          <input
            id={`${id}-angle`}
            type="range"
            className="range"
            min={-ANGLE_LIMIT}
            max={ANGLE_LIMIT}
            step={0.5}
            value={angle ?? 0}
            aria-valuetext={angle === null ? 'Mixed' : `${angle.toFixed(1)} degrees`}
            onChange={(event) => {
              actions.onTransform({ angle: Number(event.target.value) }, gesture('angle'))
            }}
            onPointerUp={actions.onGestureEnd}
            onBlur={actions.onGestureEnd}
          />
        </Field>
        <Button
          size="sm"
          className="mt-2 w-full"
          inactive={straightening}
          onClick={actions.onAutoStraighten}
        >
          {straightening ? 'Looking for lines…' : `Auto-straighten ${n} pages`}
        </Button>
      </div>

      <div>
        <Field id={`${id}-scale`} label="Scale" value={percent === null ? 'Mixed' : `${percent}%`}>
          <input
            id={`${id}-scale`}
            type="range"
            className="range"
            min={SCALE_MIN * 100}
            max={SCALE_MAX * 100}
            step={1}
            value={percent ?? 100}
            aria-valuetext={percent === null ? 'Mixed' : `${percent} percent`}
            onChange={(event) => {
              actions.onTransform({ scale: Number(event.target.value) / 100 }, gesture('scale'))
            }}
            onPointerUp={actions.onGestureEnd}
            onBlur={actions.onGestureEnd}
          />
        </Field>
        <div className="mt-3">
          <Segmented
            legend="Placement"
            value={fit}
            options={FITS}
            onChange={(fit) => {
              actions.onTransform({ fit })
            }}
          />
        </div>
      </div>

      <div>
        <Segmented
          legend="Filter"
          value={filter}
          options={FILTERS}
          disabled={images.length === 0}
          describedBy={`${id}-filter-note`}
          onChange={(filter) => {
            actions.onTransform({ filter })
          }}
        />
        <p id={`${id}-filter-note`} className="mt-2 text-xs leading-relaxed text-ink-muted">
          {images.length === 0
            ? 'PDF pages keep their original vector content.'
            : images.length < n
              ? `Applies to the ${images.length} image ${images.length === 1 ? 'page' : 'pages'}; PDF pages keep their vector content.`
              : filter === null
                ? 'These pages use different filters.'
                : 'Greyscale and B&W clean up photographed paper.'}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex" role="group" aria-label="Reorder">
          <IconButton
            variant="secondary"
            label="Move pages earlier"
            inactive={!canEarlier}
            onClick={() => {
              actions.onShift(-1)
            }}
          >
            <ArrowLeftIcon width={16} height={16} />
          </IconButton>
          <IconButton
            variant="secondary"
            className="-ml-px"
            label="Move pages later"
            inactive={!canLater}
            onClick={() => {
              actions.onShift(1)
            }}
          >
            <ArrowRightIcon width={16} height={16} />
          </IconButton>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button size="tile" onClick={actions.onDuplicate}>
            <CopyIcon width={16} height={16} /> Duplicate
          </Button>
          <Button size="tile" inactive={!changed} onClick={actions.onReset}>
            <ResetIcon width={16} height={16} /> Reset
          </Button>
          <Button size="tile" variant="danger" onClick={actions.onRemove}>
            <TrashIcon width={16} height={16} /> Remove
          </Button>
        </div>
      </div>
    </section>
  )
}
