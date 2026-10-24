import { useEffect, useId, useMemo, useRef } from 'react'
import { ID_CARD, layoutSheet } from '../core/geometry'
import { numberMark } from '../core/pageNumbers'
import { watermarkMark } from '../core/watermark'
import type { Asset, Page, Settings, SheetKind } from '../core/model'
import { SHEET_CAPACITY } from '../core/model'
import { formatLength } from '../core/units'
import { Button, IconButton, Segmented } from './controls'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SplitIcon,
  TrashIcon,
} from './Icons'
import { usePageThumbs } from '../hooks/usePageThumb'
import { PagePreview } from './PagePreview'
import { SHEET_NAMES, pageNumber } from './format'

const KINDS: readonly { value: SheetKind; label: string }[] = [
  { value: 'two', label: '2' },
  { value: 'four', label: '4' },
  { value: 'id-card', label: 'ID card' },
]

export interface SheetActions {
  onKind: (kind: SheetKind) => void
  onRotate: (by: -1 | 1) => void
  onMove: (by: -1 | 1) => void
  onDuplicate: () => void
  onSplit: () => void
  onRemove: () => void
}

/**
 * A combined page (#76): its layout, and the page-level actions. Each
 * picture keeps the rotation, crop and filter it had; Split gives them back
 * as pages to change one.
 */
export const SheetInspector = ({
  page,
  assets,
  index,
  count,
  settings,
  actions,
}: {
  page: Page & { sheet: NonNullable<Page['sheet']> }
  assets: Record<string, Asset>
  index: number
  count: number
  settings: Settings
  actions: SheetActions
}) => {
  const id = useId()
  const { kind, slots } = page.sheet
  const sheet = useMemo(() => layoutSheet(settings, assets, page), [settings, assets, page])
  const mark = numberMark(settings.pageNumbers, index, sheet.page, sheet.content.x)
  const watermark = watermarkMark(
    settings.watermark,
    page.id,
    sheet.page,
    sheet.content.x,
    settings.pageNumbers,
  )
  const thumbUrls = usePageThumbs(
    slots.flatMap((slot) => {
      const asset = assets[slot.assetId]
      return asset ? [{ asset, page: slot }] : []
    }),
  )
  const boxRatio = Math.max(sheet.page.width / sheet.page.height, 3 / 4)
  // Only layouts with room for every picture can be chosen.
  const fixed = slots.length > 2
  const card = (points: number) => formatLength(points, settings.unit)

  const earlier = useRef<HTMLButtonElement>(null)
  const later = useRef<HTMLButtonElement>(null)
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

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-6">
      <header>
        <p className="label text-ink-faint">
          Page {pageNumber(index)} <span aria-hidden="true">/</span>
          <span className="sr-only">of</span> {pageNumber(count - 1)}
        </p>
        <h2
          id={`${id}-heading`}
          className="mt-2 text-xl leading-tight font-semibold tracking-tight text-ink"
        >
          {SHEET_NAMES[kind]}
        </h2>
        <ol className="mt-2 text-xs leading-relaxed text-ink-muted">
          {slots.map((slot, i) => (
            // A slot is its position on the page.
            <li key={i} className="truncate">
              {assets[slot.assetId]?.name}
            </li>
          ))}
        </ol>
      </header>

      <div
        className="relative w-full rounded-xl bg-paper-sunk p-5"
        style={{ aspectRatio: boxRatio }}
      >
        <PagePreview
          sheet={sheet}
          thumbUrls={thumbUrls}
          showMargins
          mark={mark}
          watermark={watermark}
        />
      </div>

      <div>
        <Segmented
          legend="Pictures per page"
          value={kind}
          options={KINDS}
          disabled={fixed}
          describedBy={`${id}-kind-note`}
          onChange={actions.onKind}
        />
        <p id={`${id}-kind-note`} className="mt-2 text-xs leading-relaxed text-ink-muted">
          {fixed
            ? `${String(slots.length)} pictures need the 4-per-page layout. Split the page to lay them out another way.`
            : kind === 'id-card'
              ? `Each side prints at real card size, ${card(ID_CARD.width)} × ${card(ID_CARD.height)}. Crop each side to the card’s edges for an exact copy.`
              : 'Each picture keeps its rotation, crop and filter. Split the page to change one.'}
        </p>
        {slots.length < SHEET_CAPACITY[kind] && (
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            The empty space keeps every picture the same size.
          </p>
        )}
      </div>

      <div>
        <p className="label mb-2 text-ink-faint" id={`${id}-rotate`}>
          Rotate each picture
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

      <div className="flex flex-col gap-2">
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
            ref={later}
            variant="secondary"
            className="-ml-px"
            label="Move page later"
            disabled={index === count - 1}
            onClick={() => {
              move(1)
            }}
          >
            <ArrowRightIcon width={16} height={16} />
          </IconButton>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button size="tile" onClick={actions.onDuplicate}>
            <CopyIcon width={16} height={16} /> Duplicate
          </Button>
          <Button size="tile" onClick={actions.onSplit}>
            <SplitIcon width={16} height={16} /> Split
          </Button>
          <Button size="tile" variant="danger" onClick={actions.onRemove}>
            <TrashIcon width={16} height={16} /> Remove
          </Button>
        </div>
      </div>
    </section>
  )
}
