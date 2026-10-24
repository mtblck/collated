import { useEffect, useId, useMemo, useRef } from 'react'
import { layoutSheet } from '../core/geometry'
import { numberMark } from '../core/pageNumbers'
import type { Asset, Page, Settings } from '../core/model'
import { Button, IconButton, Segmented } from './controls'
import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, TrashIcon } from './Icons'
import { PagePreview } from './PagePreview'
import { BLANK_NAME, pageNumber } from './format'
import { SectionField } from './SectionField'

type Turn = 'portrait' | 'landscape'

const TURNS: readonly { value: Turn; label: string }[] = [
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
]

export interface BlankActions {
  onLandscape: (landscape: boolean) => void
  onMove: (by: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  /** Names the section that starts at this page; blank removes it. */
  onSection: (title: string) => void
  onGestureEnd: () => void
}

/**
 * An inserted blank page (#80): its size from page setup, which way it
 * turns when that's left to each page, and the page-level actions.
 */
export const BlankInspector = ({
  page,
  like,
  assets,
  index,
  count,
  settings,
  actions,
}: {
  page: Page
  /** The page a "match image" blank takes its size from. */
  like: Page | undefined
  assets: Record<string, Asset>
  index: number
  count: number
  settings: Settings
  actions: BlankActions
}) => {
  const id = useId()
  const sheet = useMemo(
    () => layoutSheet(settings, assets, page, like),
    [settings, assets, page, like],
  )
  const mark = numberMark(settings.pageNumbers, index, sheet.page, sheet.content.x)
  const boxRatio = Math.max(sheet.page.width / sheet.page.height, 3 / 4)
  const landscape = page.turns % 2 === 1
  // Page setup decides unless its orientation is Auto.
  const fixed = settings.orientation !== 'auto'

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
          {BLANK_NAME}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-ink-muted">
          Nothing is printed on it but its page number, if page numbers are on.
        </p>
      </header>

      <div
        className="relative w-full rounded-xl bg-paper-sunk p-5"
        style={{ aspectRatio: boxRatio }}
      >
        <PagePreview sheet={sheet} thumbUrls={[]} showMargins mark={mark} />
      </div>

      <div>
        <Segmented
          legend="Orientation"
          value={fixed ? settings.orientation : landscape ? 'landscape' : 'portrait'}
          options={TURNS}
          disabled={fixed}
          describedBy={`${id}-size-note`}
          onChange={(value) => {
            actions.onLandscape(value === 'landscape')
          }}
        />
        <p id={`${id}-size-note`} className="mt-2 text-xs leading-relaxed text-ink-muted">
          {settings.size === 'image'
            ? like
              ? 'The same size as the page before it, as page size is Match image.'
              : 'Letter size: there is no page with a picture to match.'
            : fixed
              ? `Page setup makes every page ${settings.orientation}.`
              : 'Sized by page setup.'}
        </p>
      </div>

      <SectionField
        value={page.section ?? ''}
        onChange={actions.onSection}
        onDone={actions.onGestureEnd}
      />

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
        <div className="grid grid-cols-2 gap-2">
          <Button size="tile" onClick={actions.onDuplicate}>
            <CopyIcon width={16} height={16} /> Duplicate
          </Button>
          <Button size="tile" variant="danger" onClick={actions.onRemove}>
            <TrashIcon width={16} height={16} /> Remove
          </Button>
        </div>
      </div>
    </section>
  )
}
