import { useId, useRef, useState, type ReactNode } from 'react'
import type { DuplexGroups, SortKey } from '../core/order'
import { cx } from './cx'
import { Button } from './controls'
import {
  InterleaveIcon,
  MoonIcon,
  MoreIcon,
  PageIcon,
  ReverseIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SortIcon,
  SunIcon,
  TrashIcon,
  UprightIcon,
} from './Icons'
import { DOCS_URL, PRIVACY_URL, SOURCE_URL, SUPPORT_URL } from './links'
import { POPOVER_PANEL, closeOwnPopover, useCloseOnFocusOut } from './popover'
import { useTheme } from './theme'
import { TOOLBAR_ITEM } from './toolbarItem'

const ITEM =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-ink/5 aria-disabled:text-ink-faint aria-disabled:hover:bg-transparent'

/** A page-order change from the More menu; App works out which pages. */
export type Arrange =
  | { type: 'interleave'; backsReversed: boolean }
  | { type: 'reverse' }
  | { type: 'sort'; by: SortKey }

const pagesWord = (n: number) => `${n} ${n === 1 ? 'page' : 'pages'}`

const range = (from: number, to: number) => (from === to ? `page ${from}` : `pages ${from}–${to}`)

/** What the interleave dialog says it will pair, so nobody is surprised. */
const describeGroups = (groups: DuplexGroups, scoped: boolean) => {
  const f = groups.fronts.length
  const b = groups.backs.length
  const [frontName, backName] = groups.names ?? []
  return groups.by === 'imports'
    ? `Fronts: ${frontName ?? ''} (${pagesWord(f)}). Backs: ${backName ?? ''} (${pagesWord(b)}).`
    : scoped
      ? `Fronts: the first ${pagesWord(f)} selected. Backs: the other ${pagesWord(b)}.`
      : `Fronts: ${range(1, f)}. Backs: ${range(f + 1, f + b)}.`
}

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div role="group" aria-label={label} className="flex flex-col py-1.5 first:pt-0 last:pb-0">
    {children}
  </div>
)

/**
 * Everything the toolbar doesn't need on show: Insert blank page, whole-document rotation and
 * auto-rotate, page order (interleave, reverse, sort), Start over, the theme, and links out. A disclosure (a popover of ordinary buttons and
 * links, Tab to move), not an ARIA menu: menus promise arrow-key behaviour
 * and roles screen readers treat differently, for no gain here.
 */
export const MoreMenu = ({
  pageCount,
  onRotateAll,
  onAutoRotate,
  rotating,
  duplex,
  orderScope,
  onArrange,
  blankAfter,
  onInsertBlank,
  busy,
  onStartOver,
  keepWork,
  onKeepWork,
}: {
  pageCount: number
  onRotateAll: (by: -1 | 1) => void
  /** Turns pages upright by reading their text (the selected ones, if any). */
  onAutoRotate: () => void
  /** Auto-rotate is running. */
  rotating: boolean
  /** How Interleave would split the document; null with under two pages. */
  duplex: DuplexGroups | null
  /** How many selected pages page order works on; null for every page. */
  orderScope: number | null
  onArrange: (arrange: Arrange) => void
  /** The page an inserted blank page goes after (1-based); null for the end. */
  blankAfter: number | null
  /** Adds an empty page (#80), sized by page setup. */
  onInsertBlank: () => void
  /** Importing or exporting: Start over waits until that's done. */
  busy: boolean
  onStartOver: () => void
  keepWork: boolean
  onKeepWork: (keep: boolean) => void
}) => {
  const id = useId()
  const panelId = `${id}-more`
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLDialogElement>(null)
  const interleave = useRef<HTMLDialogElement>(null)
  const [backsReversed, setBacksReversed] = useState(true)
  const canArrange = pageCount > 1
  useCloseOnFocusOut(panel, panelId)
  const { theme, next, toggle } = useTheme()

  return (
    <>
      <button
        type="button"
        ref={opener}
        popoverTarget={panelId}
        {...TOOLBAR_ITEM}
        aria-label="More"
        title="More"
        className="anchor-more inline-flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-ink/5 hover:text-ink"
      >
        <MoreIcon />
      </button>
      <div
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label="More"
        ref={panel}
        className={cx(POPOVER_PANEL, 'popover-end from-more w-[min(17rem,calc(100vw-1rem))] p-2')}
      >
        <div className="divide-y divide-rule-soft">
          <Group label="Pages">
            <button
              type="button"
              className={ITEM}
              aria-describedby={`${id}-blank-help`}
              onClick={(event) => {
                closeOwnPopover(event.currentTarget)
                onInsertBlank()
              }}
            >
              <PageIcon width={18} height={18} className="text-ink-muted" />
              Insert blank page
            </button>
            <p id={`${id}-blank-help`} className="px-3 pb-1 text-xs text-ink-muted">
              {blankAfter === null
                ? 'At the end, sized by page setup.'
                : `After page ${String(blankAfter)}, sized by page setup.`}
            </p>
          </Group>
          <Group label="Document">
            {(
              [
                [-1, 'Rotate all pages left', RotateLeftIcon],
                [1, 'Rotate all pages right', RotateRightIcon],
              ] as const
            ).map(([by, label, Icon]) => (
              <button
                key={by}
                type="button"
                className={ITEM}
                {...(pageCount === 0 ? { 'aria-disabled': true } : {})}
                onClick={() => {
                  if (pageCount > 0) onRotateAll(by)
                }}
              >
                <Icon width={18} height={18} className="text-ink-muted" />
                {label}
              </button>
            ))}
            <button
              type="button"
              className={ITEM}
              aria-describedby={`${id}-upright-help`}
              {...(pageCount === 0 || rotating ? { 'aria-disabled': true } : {})}
              onClick={(event) => {
                if (pageCount === 0 || rotating) return
                closeOwnPopover(event.currentTarget)
                onAutoRotate()
              }}
            >
              <UprightIcon width={18} height={18} className="text-ink-muted" />
              {rotating
                ? 'Finding which way up…'
                : orderScope !== null
                  ? `Auto-rotate ${String(orderScope)} selected pages`
                  : 'Auto-rotate pages'}
            </button>
            <p id={`${id}-upright-help`} className="px-3 pb-1 text-xs text-ink-muted">
              Reads the text to turn upside-down and sideways pages upright. Downloads about 6 MB
              the first time.
            </p>
          </Group>
          <Group label="Page order">
            {orderScope !== null && (
              <p className="px-3 pt-1 pb-0.5 text-xs text-ink-muted">
                For the {orderScope} selected pages
              </p>
            )}
            <button
              type="button"
              className={ITEM}
              {...(!duplex ? { 'aria-disabled': true } : {})}
              onClick={(event) => {
                if (!duplex) return
                closeOwnPopover(event.currentTarget)
                interleave.current?.showModal()
              }}
            >
              <InterleaveIcon width={18} height={18} className="text-ink-muted" />
              Interleave fronts and backs…
            </button>
            {(
              [
                [{ type: 'reverse' }, 'Reverse page order', ReverseIcon],
                [{ type: 'sort', by: 'name' }, 'Sort by file name', SortIcon],
                [{ type: 'sort', by: 'date' }, 'Sort by date taken', SortIcon],
              ] as const
            ).map(([arrange, label, Icon]) => (
              <button
                key={label}
                type="button"
                className={ITEM}
                {...(!canArrange ? { 'aria-disabled': true } : {})}
                onClick={() => {
                  if (canArrange) onArrange(arrange)
                }}
              >
                <Icon width={18} height={18} className="text-ink-muted" />
                {label}
              </button>
            ))}
          </Group>
          <Group label="Start over">
            <button
              type="button"
              className={ITEM}
              {...(busy ? { 'aria-disabled': true } : {})}
              onClick={(event) => {
                if (busy) return
                closeOwnPopover(event.currentTarget)
                confirm.current?.showModal()
              }}
            >
              <TrashIcon width={18} height={18} className="text-ink-muted" />
              Start over…
            </button>
          </Group>
          <Group label="On this device">
            {/* A switch, not a checkbox in a label: it reads as one control and
                the whole row is the target. */}
            <button
              type="button"
              role="switch"
              aria-checked={keepWork}
              aria-describedby={`${id}-keep-help`}
              className={ITEM}
              onClick={() => {
                onKeepWork(!keepWork)
              }}
            >
              <span
                aria-hidden="true"
                className={cx(
                  'relative h-[18px] w-8 shrink-0 rounded-full transition-colors',
                  keepWork ? 'bg-accent' : 'bg-control',
                )}
              >
                <span
                  className={cx(
                    'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-paper transition-transform',
                    keepWork && 'translate-x-3.5',
                  )}
                />
              </span>
              Keep work after a reload
            </button>
            <p id={`${id}-keep-help`} className="px-3 pb-1 text-xs text-ink-muted">
              {keepWork
                ? 'Saved in this browser only, never uploaded. The password is never saved.'
                : 'Off: closing or reloading the tab loses this document.'}
            </p>
          </Group>
          <Group label="Appearance">
            <button
              type="button"
              className={ITEM}
              onClick={(event) => {
                toggle()
                closeOwnPopover(event.currentTarget)
              }}
            >
              {theme === 'dark' ? (
                <SunIcon width={18} height={18} className="text-ink-muted" />
              ) : (
                <MoonIcon width={18} height={18} className="text-ink-muted" />
              )}
              Use {next} theme
            </button>
          </Group>
          <Group label="About Collated">
            <a className={ITEM} href={DOCS_URL} target="_blank" rel="noopener">
              Help and docs
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a className={ITEM} href={PRIVACY_URL} target="_blank" rel="noopener">
              Privacy
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a className={ITEM} href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
              Support Collated
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <a className={ITEM} href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
              Source code
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Group>
        </div>
      </div>
      {/* Outside the popover, which is hidden once the dialog opens. */}
      <dialog
        ref={interleave}
        aria-labelledby={`${id}-interleave`}
        aria-describedby={`${id}-interleave-help`}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
        onClose={() => {
          opener.current?.focus()
        }}
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id={`${id}-interleave`} className="text-lg font-semibold tracking-tight">
            Interleave fronts and backs
          </h2>
          <div id={`${id}-interleave-help`} className="flex flex-col gap-2 text-sm text-ink-muted">
            <p>
              For a two-sided scan made one side at a time: the pages are put in order front 1, back
              1, front 2, back 2, and so on.
            </p>
            {duplex && <p className="text-ink">{describeGroups(duplex, orderScope !== null)}</p>}
            {duplex && duplex.fronts.length !== duplex.backs.length && (
              <p>The counts differ, so the extra pages will go at the end.</p>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--c-ink)]"
              checked={backsReversed}
              onChange={(event) => {
                setBacksReversed(event.target.checked)
              }}
            />
            <span>
              Backs are in reverse order
              <span className="block text-xs text-ink-muted">
                Usual when the stack was turned over and scanned again: the last back comes first.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => {
                interleave.current?.close()
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                interleave.current?.close()
                onArrange({ type: 'interleave', backsReversed })
              }}
            >
              Interleave
            </Button>
          </div>
        </div>
      </dialog>
      <dialog
        ref={confirm}
        aria-labelledby={`${id}-start-over`}
        aria-describedby={`${id}-start-over-help`}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
        onClose={() => {
          // The dialog would return focus into the closed popover. Starting
          // over moves focus on its own (the toolbar goes away).
          const d = confirm.current
          if (d?.returnValue !== 'start-over') opener.current?.focus()
          if (d) d.returnValue = ''
        }}
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id={`${id}-start-over`} className="text-lg font-semibold tracking-tight">
            Start over?
          </h2>
          <p id={`${id}-start-over-help`} className="text-sm text-ink-muted">
            This removes all {pageCount} {pageCount === 1 ? 'page' : 'pages'} and their undo
            history, clears the password and deletes the copy kept on this device. It can't be
            undone. Your page setup is kept.
          </p>
          <div className="flex justify-end gap-2">
            {/* First, so the dialog opens on it: Enter or a stray tap keeps the work. */}
            <Button
              onClick={() => {
                confirm.current?.close()
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                // Something may have started since the dialog opened.
                if (busy) {
                  confirm.current?.close()
                  return
                }
                confirm.current?.close('start-over')
                onStartOver()
              }}
            >
              Start over
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
