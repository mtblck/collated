import {
  Accessibility,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { memo, useMemo } from 'react'
import { layoutPage } from '../core/geometry'
import { numberMark } from '../core/pageNumbers'
import type { Asset, Page, Settings } from '../core/model'
import { IconButton } from './controls'
import { cx } from './cx'
import { pageNumber } from './format'
import { GripIcon, RotateLeftIcon, RotateRightIcon, TrashIcon } from './Icons'
import { usePageThumb } from '../hooks/usePageThumb'
import { PagePreview } from './PagePreview'

/** Card preview boxes are 4:5, close to every paper size, so rows stay level. */
const CARD_RATIO = 4 / 5

interface CardProps {
  page: Page
  asset: Asset
  index: number
  settings: Settings
  selected: boolean
  onSelect: (id: string) => void
  onRotate: (id: string, by: -1 | 1) => void
  onRemove: (id: string) => void
}

const PageCard = memo(function PageCard({
  page,
  asset,
  index,
  settings,
  selected,
  onSelect,
  onRotate,
  onRemove,
}: CardProps) {
  const { ref, handleRef, isDragging } = useSortable({ id: page.id, index })
  const layout = useMemo(() => layoutPage(settings, asset, page), [settings, asset, page])
  const mark = numberMark(settings.pageNumbers, index, layout.page, layout.content.x)
  const thumbUrl = usePageThumb(asset, page)
  const n = pageNumber(index)

  const reveal =
    'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'

  return (
    <li
      ref={ref}
      className={cx('group relative flex min-w-0 flex-col', isDragging && 'z-10 opacity-90')}
      data-page-id={page.id}
    >
      <div className="relative rounded-[3px] p-3 transition-colors hover:bg-ink/[0.035]">
        <button
          type="button"
          className="block aspect-[4/5] w-full focus-visible:outline-offset-4"
          aria-pressed={selected}
          aria-label={`Page ${index + 1}: ${asset.name}`}
          onClick={() => {
            onSelect(page.id)
          }}
        >
          <PagePreview
            layout={layout}
            thumbUrl={thumbUrl}
            boxRatio={CARD_RATIO}
            selected={selected}
            mark={mark}
          />
        </button>
        <button
          type="button"
          ref={handleRef}
          className={cx(
            'absolute top-1.5 left-1.5 flex size-8 cursor-grab touch-none items-center justify-center rounded-[2px] bg-paper text-ink-muted shadow-sm hover:text-ink active:cursor-grabbing',
            reveal,
          )}
          aria-label={`Reorder page ${index + 1}`}
          aria-describedby="reorder-instructions"
        >
          <GripIcon />
        </button>
        <div
          className={cx(
            'absolute right-1.5 bottom-1.5 flex rounded-[2px] bg-paper p-0.5 shadow-sm',
            reveal,
          )}
        >
          <IconButton
            small
            label={`Rotate page ${index + 1} left`}
            onClick={() => {
              onRotate(page.id, -1)
            }}
          >
            <RotateLeftIcon width={16} height={16} />
          </IconButton>
          <IconButton
            small
            label={`Rotate page ${index + 1} right`}
            onClick={() => {
              onRotate(page.id, 1)
            }}
          >
            <RotateRightIcon width={16} height={16} />
          </IconButton>
          <IconButton
            small
            label={`Remove page ${index + 1}`}
            onClick={() => {
              onRemove(page.id)
            }}
          >
            <TrashIcon width={16} height={16} />
          </IconButton>
        </div>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2 px-3">
        <span
          className={cx('label shrink-0', selected ? 'text-accent' : 'text-ink')}
          aria-hidden="true"
        >
          {n}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted" title={asset.name}>
          {asset.name}
        </span>
      </div>
    </li>
  )
})

export const PageGrid = ({
  pages,
  assets,
  settings,
  selectedId,
  onSelect,
  onRotate,
  onRemove,
  onMove,
}: {
  pages: Page[]
  assets: Record<string, Asset>
  settings: Settings
  selectedId: string | null
  onSelect: (id: string) => void
  onRotate: (id: string, by: -1 | 1) => void
  onRemove: (id: string) => void
  onMove: (from: number, to: number) => void
}) => {
  const count = pages.length
  const position = (index: number) => `position ${index + 1} of ${count}`

  return (
    <DragDropProvider
      plugins={(defaults) => [
        ...defaults,
        // Speak in page numbers rather than internal ids.
        Accessibility.configure({
          announcements: {
            dragstart: ({ operation: { source } }: DragStartEvent) =>
              isSortable(source) ? `Picked up page ${source.index + 1}.` : undefined,
            dragover: ({ operation: { source } }: DragOverEvent) =>
              isSortable(source) ? `Page moved to ${position(source.index)}.` : undefined,
            dragend: ({ operation: { source }, canceled }: DragEndEvent) => {
              if (!isSortable(source)) return undefined
              return canceled
                ? `Move cancelled. Page returned to ${position(source.initialIndex)}.`
                : `Page dropped at ${position(source.index)}.`
            },
          },
          screenReaderInstructions: {
            draggable:
              'Press Space or Enter to pick up the page, use the arrow keys to move it, then Space or Enter to drop it, or Escape to cancel.',
          },
        }),
      ]}
      onDragEnd={({ operation: { source }, canceled }) => {
        if (canceled || !isSortable(source)) return
        if (source.initialIndex !== source.index) onMove(source.initialIndex, source.index)
      }}
    >
      <p id="reorder-instructions" className="sr-only">
        Drag to reorder, or press Space to pick up and use the arrow keys to move.
      </p>
      <ol
        className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]"
        aria-label={`${count} ${count === 1 ? 'page' : 'pages'}`}
      >
        {pages.map((page, index) => {
          const asset = assets[page.assetId]
          if (!asset) return null
          return (
            <PageCard
              key={page.id}
              page={page}
              asset={asset}
              index={index}
              settings={settings}
              selected={page.id === selectedId}
              onSelect={onSelect}
              onRotate={onRotate}
              onRemove={onRemove}
            />
          )
        })}
      </ol>
    </DragDropProvider>
  )
}
