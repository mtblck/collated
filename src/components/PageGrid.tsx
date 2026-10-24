import {
  Accessibility,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/dom'
import { DragDropProvider } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { memo, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { layoutSheet } from '../core/geometry'
import { numberMark } from '../core/pageNumbers'
import { picturesOf, type Asset, type Page, type Settings } from '../core/model'
import { IconButton } from './controls'
import { cx } from './cx'
import { pageName, pageNumber } from './format'
import { CheckIcon, GripIcon, RotateLeftIcon, RotateRightIcon, TrashIcon } from './Icons'
import { pickModeOf, type PickMode } from '../core/selection'
import { usePageThumbs } from '../hooks/usePageThumb'
import { PagePreview } from './PagePreview'

const NONE: readonly string[] = []

interface CardProps {
  page: Page
  assets: Record<string, Asset>
  index: number
  settings: Settings
  selected: boolean
  /** Select mode (#65): a tap toggles the page, shown with a checkbox. */
  selecting: boolean
  /** Lifted with a group being dragged by another page: dimmed. */
  carried: boolean
  /** Where a dragged group would land. */
  dropTarget: boolean
  /** Looks blank (#68): badged, and said in its name. */
  blank: boolean
  onSelect: (id: string, mode: PickMode) => void
  onRotate: (id: string, by: -1 | 1) => void
  onRemove: (id: string) => void
}

const PageCard = memo(function PageCard({
  page,
  assets,
  index,
  settings,
  selected,
  selecting,
  carried,
  dropTarget,
  blank,
  onSelect,
  onRotate,
  onRemove,
}: CardProps) {
  const { ref, handleRef, isDragging } = useSortable({ id: page.id, index })
  const sheet = useMemo(() => layoutSheet(settings, assets, page), [settings, assets, page])
  const mark = numberMark(settings.pageNumbers, index, sheet.page, sheet.content.x)
  const thumbUrls = usePageThumbs(
    picturesOf(page).flatMap((slot) => {
      const asset = assets[slot.assetId]
      return asset ? [{ asset, page: slot }] : []
    }),
  )
  const name = pageName(page, assets)
  const n = pageNumber(index)

  const reveal =
    'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100'

  return (
    <li
      ref={ref}
      className={cx(
        'group relative flex min-w-0 flex-col transition-opacity',
        isDragging && 'z-10 opacity-90',
        carried && 'opacity-40',
      )}
      data-page-id={page.id}
    >
      <div
        className={cx(
          'relative rounded-2xl p-3 transition-colors hover:bg-ink/[0.04]',
          dropTarget && 'bg-accent-dim outline-2 outline-accent outline-dashed hover:bg-accent-dim',
        )}
      >
        <button
          type="button"
          // 4:5, close to every paper size, so rows stay level.
          className="block aspect-[4/5] w-full focus-visible:outline-offset-4"
          // A plain click selects just this page, so it isn't a toggle; in
          // select mode it is one. Shift and ⌘/Ctrl extend the selection,
          // with the mouse or with Enter and Space.
          {...(selecting
            ? { 'aria-pressed': selected }
            : { 'aria-current': selected ? 'true' : undefined })}
          data-page-select
          aria-label={`Page ${index + 1}: ${name}${blank ? ', looks blank' : ''}`}
          onClick={(event) => {
            const mode = pickModeOf(event)
            onSelect(page.id, selecting && mode === 'only' ? 'toggle' : mode)
          }}
          // A keyboard click carries no modifiers, so read them here.
          onKeyDown={(event) => {
            const mode = pickModeOf(event)
            if (mode === 'only' || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            onSelect(page.id, mode)
          }}
        >
          <PagePreview sheet={sheet} thumbUrls={thumbUrls} selected={selected} mark={mark} />
        </button>
        {blank && (
          <span
            className="label pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-paper px-2 py-1 text-ink-muted shadow-panel"
            aria-hidden="true"
          >
            Looks blank
          </span>
        )}
        {selecting && (
          <span
            className={cx(
              'pointer-events-none absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full border-2 shadow-panel',
              selected ? 'border-accent bg-accent text-on-accent' : 'border-ink-faint bg-paper',
            )}
            aria-hidden="true"
          >
            {selected && <CheckIcon width={16} height={16} />}
          </span>
        )}
        <button
          type="button"
          ref={handleRef}
          className={cx(
            'absolute top-1.5 left-1.5 flex size-8 cursor-grab touch-none items-center justify-center rounded-full bg-paper text-ink-muted shadow-panel hover:text-ink active:cursor-grabbing',
            reveal,
          )}
          aria-label={`Reorder page ${index + 1}`}
          aria-describedby="reorder-instructions"
        >
          <GripIcon />
        </button>
        <div
          className={cx(
            'absolute right-1.5 bottom-1.5 flex rounded-full bg-paper p-0.5 shadow-panel',
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
          className={cx('label shrink-0', selected ? 'text-accent' : 'text-ink-muted')}
          aria-hidden="true"
        >
          {n}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted" title={name}>
          {name}
        </span>
      </div>
    </li>
  )
})

export const PageGrid = ({
  pages,
  assets,
  settings,
  selectedIds,
  blankIds = NONE,
  selecting,
  onSelect,
  onRotate,
  onRemove,
  onMove,
  onMoveSelected,
  onDragging,
}: {
  pages: Page[]
  assets: Record<string, Asset>
  settings: Settings
  selectedIds: readonly string[]
  /** Pages that look blank (#68). */
  blankIds?: readonly string[]
  selecting: boolean
  onSelect: (id: string, mode: PickMode) => void
  onRotate: (id: string, by: -1 | 1) => void
  onRemove: (id: string) => void
  onMove: (from: number, to: number) => void
  /** A selected page was dragged from `from` to `to`: the whole selection goes. */
  onMoveSelected: (from: number, to: number) => void
  /** A drag started or ended (Escape belongs to it meanwhile). */
  onDragging?: (dragging: boolean) => void
}) => {
  const count = pages.length
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const blank = useMemo(() => new Set(blankIds), [blankIds])
  // Dragging a page of a multi-page selection carries the selection (#65).
  // The list isn't sorted under the pointer then (only the dragged page
  // could move); the card it would land on is marked instead.
  const group = (id: unknown) => selected.size > 1 && typeof id === 'string' && selected.has(id)
  const groupRef = useRef(group)
  useEffect(() => {
    groupRef.current = group
  })
  const sizeRef = useRef(selected.size)
  useEffect(() => {
    sizeRef.current = selected.size
  }, [selected.size])
  const [carrying, setCarrying] = useState<{ from: string; over: string | null } | null>(null)
  // The provider applies its plugins once; announcements read the count
  // from here so they never speak a stale one ("position 1 of 0").
  const countRef = useRef(count)
  useEffect(() => {
    countRef.current = count
  }, [count])
  const plugins = useMemo(() => {
    const position = (index: number) => `position ${index + 1} of ${countRef.current}`
    const plugins: ComponentProps<typeof DragDropProvider>['plugins'] = (defaults) => [
      ...defaults,
      // Speak in page numbers rather than internal ids.
      Accessibility.configure({
        announcements: {
          dragstart: ({ operation: { source } }: DragStartEvent) =>
            isSortable(source)
              ? groupRef.current(source.id)
                ? `Picked up ${sizeRef.current} selected pages.`
                : `Picked up page ${source.index + 1}.`
              : undefined,
          // Dragover fires before the list is reordered, so the source's own
          // index is still the old one; the target is where it's going.
          dragover: ({ operation: { source, target } }: DragOverEvent) =>
            isSortable(source) && isSortable(target)
              ? groupRef.current(source.id)
                ? `Pages will go at page ${target.index + 1}.`
                : `Page moved to ${position(target.index)}.`
              : undefined,
          dragend: ({ operation: { source, target }, canceled }: DragEndEvent) => {
            if (!isSortable(source)) return undefined
            if (groupRef.current(source.id)) {
              return canceled || !isSortable(target)
                ? 'Move cancelled. The pages stay where they were.'
                : `${sizeRef.current} pages dropped at page ${target.index + 1}.`
            }
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
    ]
    return plugins
  }, [])

  return (
    <DragDropProvider
      plugins={plugins}
      onDragStart={({ operation: { source } }) => {
        onDragging?.(true)
        if (source && group(source.id)) setCarrying({ from: String(source.id), over: null })
      }}
      onDragOver={(event) => {
        const { source, target } = event.operation
        if (!source || !group(source.id)) return
        // Keep dnd-kit from sorting the list under the pointer.
        event.preventDefault()
        setCarrying({ from: String(source.id), over: target ? String(target.id) : null })
      }}
      onDragEnd={({ operation: { source, target }, canceled }) => {
        // After this event's listeners: Escape that cancelled it is spent.
        setTimeout(() => onDragging?.(false), 0)
        setCarrying(null)
        if (canceled || !isSortable(source)) return
        if (group(source.id)) {
          if (isSortable(target)) onMoveSelected(source.initialIndex, target.index)
          return
        }
        if (source.initialIndex !== source.index) onMove(source.initialIndex, source.index)
      }}
    >
      <p id="reorder-instructions" className="sr-only">
        Drag to reorder, or press Space to pick up and use the arrow keys to move. With several
        pages selected, moving one of them moves them all.
      </p>
      <ol
        className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] sm:gap-x-6 sm:gap-y-8"
        aria-label={`${count} ${count === 1 ? 'page' : 'pages'}`}
      >
        {pages.map((page, index) => {
          if (picturesOf(page).some((slot) => !assets[slot.assetId])) return null
          return (
            <PageCard
              key={page.id}
              page={page}
              assets={assets}
              index={index}
              settings={settings}
              selected={selected.has(page.id)}
              selecting={selecting}
              carried={carrying !== null && carrying.from !== page.id && selected.has(page.id)}
              dropTarget={carrying?.over === page.id && carrying.from !== page.id}
              blank={blank.has(page.id)}
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
