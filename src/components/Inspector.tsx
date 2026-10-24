import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { layoutPage, singleSheet, visiblePart } from '../core/geometry'
import { numberMark } from '../core/pageNumbers'
import type { Asset, Filter, FitMode, Page, PageTransform, Settings } from '../core/model'
import { ANGLE_LIMIT, SCALE_MAX, SCALE_MIN, isVector } from '../core/model'
import { formatBytes, formatLength } from '../core/units'
import { Button, IconButton, Segmented } from './controls'
import {
  CropIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ResetIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TrashIcon,
  ExpandIcon,
} from './Icons'
import { usePageThumb } from '../hooks/usePageThumb'
import { CropEditor } from './CropEditor'
import { PageViewer } from './PageViewer'
import { detailImage } from '../lib/detailImage'
import { PagePreview } from './PagePreview'
import { pageNumber } from './format'

/** Below this a scan starts to look soft on paper. */
const LOW_DPI = 150

const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'grey', label: 'Greyscale' },
  { value: 'bw', label: 'B&W' },
]

const FITS: readonly { value: FitMode; label: string }[] = [
  { value: 'contain', label: 'Fit' },
  { value: 'cover', label: 'Fill' },
]

export interface InspectorActions {
  onTransform: (patch: Partial<PageTransform>, gesture?: string) => void
  onGestureEnd: () => void
  onRotate: (by: -1 | 1) => void
  onMove: (by: -1 | 1) => void
  onDuplicate: () => void
  onReset: () => void
  onApplyToAll: () => void
  onRemove: () => void
  onAutoStraighten: (scope: 'page' | 'all') => void
}

const Stat = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5">
    <dt className="label text-ink-faint">{term}</dt>
    <dd className="text-right text-sm text-ink tabular-nums">{children}</dd>
  </div>
)

/** Edits the selected page: rotation, straightening, scale, fit, order. */
export const Inspector = ({
  page,
  asset,
  index,
  count,
  settings,
  actions,
  straightening = false,
}: {
  page: Page
  asset: Asset
  index: number
  count: number
  settings: Settings
  actions: InspectorActions
  /** An auto-straighten is running. */
  straightening?: boolean
}) => {
  const id = useId()
  const layout = useMemo(() => layoutPage(settings, asset, page), [settings, asset, page])
  const mark = numberMark(settings.pageNumbers, index, layout.page, layout.content.x)
  const vector = isVector(asset)
  const thumbUrl = usePageThumb(asset, page)
  const [cropping, setCropping] = useState(false)
  const [viewing, setViewing] = useState(false)
  // Stable per image and look, so the viewer loads it once.
  const { filter, corners } = page
  const loadDetail = useCallback(
    () => detailImage(asset, { filter, corners }),
    [asset, filter, corners],
  )
  const cropButton = useRef<HTMLButtonElement>(null)
  const earlier = useRef<HTMLButtonElement>(null)
  const later = useRef<HTMLButtonElement>(null)
  // Moving to an end disables that button; focus goes to its sibling.
  const focusAfterMove = useRef<'earlier' | 'later' | null>(null)
  useEffect(() => {
    const target = focusAfterMove.current
    focusAfterMove.current = null
    if (target === 'earlier') earlier.current?.focus()
    if (target === 'later') later.current?.focus()
  }, [index])
  const move = (by: -1 | 1) => {
    if (by < 0 && index - 1 === 0) focusAfterMove.current = 'later'
    if (by > 0 && index + 1 === count - 1) focusAfterMove.current = 'earlier'
    actions.onMove(by)
  }
  const lowRes = !vector && layout.dpi < LOW_DPI
  // Fill or a scale past 100% hides part of the image; the export drops it.
  const cropsHidden = !vector && visiblePart(layout) !== null
  // Hug landscape pages; give tall pages a 3:4 box so the panel stays short.
  const boxRatio = Math.max(layout.page.width / layout.page.height, 3 / 4)
  const percent = Math.round(page.scale * 100)
  const changed =
    page.turns !== 0 ||
    page.angle !== 0 ||
    page.scale !== 1 ||
    page.fit !== 'contain' ||
    page.filter !== 'original' ||
    page.corners !== null

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-6">
      <header>
        <p className="label text-ink-faint">
          Page {pageNumber(index)} <span aria-hidden="true">/</span>
          <span className="sr-only">of</span> {pageNumber(count - 1)}
        </p>
        <h2
          id={`${id}-heading`}
          className="mt-2 truncate text-xl leading-tight font-semibold tracking-tight text-ink"
          title={asset.name}
        >
          {asset.name}
        </h2>
      </header>

      <div
        className="relative w-full rounded-xl bg-paper-sunk p-5"
        style={{ aspectRatio: boxRatio }}
      >
        <PagePreview
          sheet={singleSheet(layout)}
          thumbUrls={[thumbUrl]}
          boxRatio={boxRatio}
          showMargins
          mark={mark}
        />
        {/* Over the preview rather than around it: a button can't hold the
            preview's blocks, and this keeps one clear name. */}
        <button
          type="button"
          className="group absolute inset-0 cursor-zoom-in rounded-xl focus-visible:outline-offset-2"
          aria-label={`View page ${String(index + 1)} larger`}
          onClick={() => {
            setViewing(true)
          }}
        >
          <span
            className="absolute right-2 bottom-2 inline-flex size-8 items-center justify-center rounded-full bg-paper/90 text-ink opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            aria-hidden="true"
          >
            <ExpandIcon width={16} height={16} />
          </span>
        </button>
      </div>
      {viewing && (
        <PageViewer
          title={`Page ${String(index + 1)}: ${asset.name}`}
          layout={layout}
          thumbUrl={thumbUrl}
          mark={mark}
          loadDetail={loadDetail}
          onClose={() => {
            setViewing(false)
          }}
        />
      )}

      <div>
        <p className="label mb-2 text-ink-faint" id={`${id}-crop`}>
          Crop
        </p>
        {vector ? (
          <p className="text-xs text-ink-muted">
            PDF pages are copied in as they are, with their text and anything else on the page, and
            can’t be cropped.
          </p>
        ) : (
          <div className="flex gap-2" role="group" aria-labelledby={`${id}-crop`}>
            <Button
              ref={cropButton}
              className="flex-1"
              onClick={() => {
                setCropping(true)
              }}
            >
              <CropIcon width={16} height={16} />
              {page.corners ? 'Adjust corners…' : 'Crop to the page…'}
            </Button>
            {page.corners && (
              <Button
                onClick={() => {
                  // This button goes away; keep focus on the crop control.
                  cropButton.current?.focus()
                  actions.onTransform({ corners: null })
                }}
              >
                Remove crop
              </Button>
            )}
          </div>
        )}
        {cropping && (
          <CropEditor
            asset={asset}
            turns={page.turns}
            initial={page.corners}
            onApply={(corners) => {
              actions.onTransform({ corners })
            }}
            onClose={() => {
              setCropping(false)
            }}
          />
        )}
      </div>

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
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor={`${id}-angle`} className="label text-ink-faint">
            Straighten
          </label>
          <output htmlFor={`${id}-angle`} className="text-sm text-ink tabular-nums">
            {`${page.angle > 0 ? '+' : ''}${page.angle.toFixed(1)}°`}
          </output>
        </div>
        <input
          id={`${id}-angle`}
          type="range"
          className="range"
          min={-ANGLE_LIMIT}
          max={ANGLE_LIMIT}
          step={0.5}
          value={page.angle}
          aria-valuetext={`${page.angle.toFixed(1)} degrees`}
          onChange={(event) => {
            actions.onTransform({ angle: Number(event.target.value) }, `angle:${page.id}`)
          }}
          onPointerUp={actions.onGestureEnd}
          onBlur={actions.onGestureEnd}
        />
        <div className="mt-2 flex gap-2">
          {/* Inactive while running, rather than disabled, so focus stays put. */}
          <Button
            size="sm"
            className="flex-1"
            inactive={straightening}
            onClick={() => {
              actions.onAutoStraighten('page')
            }}
          >
            {straightening ? 'Looking for lines…' : 'Auto-straighten'}
          </Button>
          <Button
            size="sm"
            disabled={count < 2}
            inactive={straightening}
            onClick={() => {
              actions.onAutoStraighten('all')
            }}
          >
            All pages
          </Button>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label htmlFor={`${id}-scale`} className="label text-ink-faint">
            Scale
          </label>
          <output htmlFor={`${id}-scale`} className="text-sm text-ink tabular-nums">
            {percent}%
          </output>
        </div>
        <input
          id={`${id}-scale`}
          type="range"
          className="range"
          min={SCALE_MIN * 100}
          max={SCALE_MAX * 100}
          step={1}
          value={percent}
          aria-valuetext={`${percent} percent`}
          onChange={(event) => {
            actions.onTransform({ scale: Number(event.target.value) / 100 }, `scale:${page.id}`)
          }}
          onPointerUp={actions.onGestureEnd}
          onBlur={actions.onGestureEnd}
        />
        <div className="mt-3">
          <Segmented
            legend="Placement"
            value={page.fit}
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
          value={vector ? 'original' : page.filter}
          options={FILTERS}
          disabled={vector}
          describedBy={`${id}-filter-note`}
          onChange={(filter) => {
            actions.onTransform({ filter })
          }}
        />
        <p id={`${id}-filter-note`} className="mt-2 text-xs leading-relaxed text-ink-muted">
          {vector
            ? 'PDF pages keep their original vector content.'
            : page.filter === 'original'
              ? 'Greyscale and B&W clean up photographed paper.'
              : 'This page’s image is re-encoded for the filter (greyscale as JPEG, B&W as lossless PNG).'}
          {cropsHidden &&
            ' Part of the image is off the page, so the PDF keeps only the part that shows (re-encoded once, to leave the rest out of the file).'}
        </p>
      </div>

      <dl className="divide-y divide-rule-soft border-y border-rule">
        {vector ? (
          <Stat term="Source">
            PDF page {(asset.pdfPage ?? 0) + 1} · {formatLength(asset.width, settings.unit)} ×{' '}
            {formatLength(asset.height, settings.unit)}
          </Stat>
        ) : (
          <Stat term="Image">
            {asset.width} × {asset.height} px · {asset.format.toUpperCase()}
          </Stat>
        )}
        <Stat term="Page">
          {formatLength(layout.page.width, settings.unit)} ×{' '}
          {formatLength(layout.page.height, settings.unit)}
        </Stat>
        <Stat term="Prints at">
          {vector ? (
            'Vector, any size'
          ) : (
            <span className={lowRes ? 'text-accent' : undefined}>
              {Math.round(layout.dpi)} dpi
              {lowRes && <span className="ml-1 text-xs">· may look soft</span>}
            </span>
          )}
        </Stat>
        <Stat term={vector ? 'Source file' : 'Stored'}>{formatBytes(asset.byteLength)}</Stat>
      </dl>

      {/* The page's actions: order and copy-to-all, then a row of equal tiles
          (#50), with Remove marked as the one that takes something away. */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex" role="group" aria-label="Reorder">
            <IconButton
              ref={earlier}
              variant="secondary"
              label="Move page earlier"
              disabled={index === 0}
              onClick={() => {
                move(-1)
              }}
            >
              <ArrowLeftIcon width={16} height={16} />
            </IconButton>
            <IconButton
              variant="secondary"
              className="-ml-px"
              ref={later}
              label="Move page later"
              disabled={index === count - 1}
              onClick={() => {
                move(1)
              }}
            >
              <ArrowRightIcon width={16} height={16} />
            </IconButton>
          </div>
          <Button className="flex-1" disabled={count < 2} onClick={actions.onApplyToAll}>
            Apply to all pages
          </Button>
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
