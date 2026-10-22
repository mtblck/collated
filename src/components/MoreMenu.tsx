import { useId, useRef, type ReactNode } from 'react'
import { cx } from './cx'
import { Button } from './controls'
import { MoonIcon, MoreIcon, RotateLeftIcon, RotateRightIcon, SunIcon, TrashIcon } from './Icons'
import { DOCS_URL, PRIVACY_URL, SOURCE_URL, SUPPORT_URL } from './links'
import { POPOVER_PANEL, closeOwnPopover, useCloseOnFocusOut } from './popover'
import { useTheme } from './theme'
import { TOOLBAR_ITEM } from './toolbarItem'

const ITEM =
  'flex w-full items-center gap-3 rounded-[2px] px-3 py-2 text-left text-sm text-ink hover:bg-ink/5 aria-disabled:text-ink-faint aria-disabled:hover:bg-transparent'

const Group = ({ label, children }: { label: string; children: ReactNode }) => (
  <div role="group" aria-label={label} className="flex flex-col py-1.5 first:pt-0 last:pb-0">
    {children}
  </div>
)

/**
 * Everything the toolbar doesn't need on show: whole-document rotation,
 * Start over, the theme, and links out. A disclosure (a popover of ordinary buttons and
 * links, Tab to move), not an ARIA menu: menus promise arrow-key behaviour
 * and roles screen readers treat differently, for no gain here.
 */
export const MoreMenu = ({
  pageCount,
  onRotateAll,
  busy,
  onStartOver,
}: {
  pageCount: number
  onRotateAll: (by: -1 | 1) => void
  /** Importing or exporting: Start over waits until that's done. */
  busy: boolean
  onStartOver: () => void
}) => {
  const id = useId()
  const panelId = `${id}-more`
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLDialogElement>(null)
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
        className="anchor-more inline-flex size-9 items-center justify-center rounded-[2px] text-ink-muted hover:bg-ink/5 hover:text-ink"
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
        ref={confirm}
        aria-labelledby={`${id}-start-over`}
        aria-describedby={`${id}-start-over-help`}
        className="m-auto w-[min(26rem,calc(100vw-2rem))] border border-rule bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50"
        onClose={() => {
          // The dialog would return focus into the closed popover. Starting
          // over moves focus on its own (the toolbar goes away).
          const d = confirm.current
          if (d?.returnValue !== 'start-over') opener.current?.focus()
          if (d) d.returnValue = ''
        }}
      >
        <div className="flex flex-col gap-4 p-5 sm:p-6">
          <h2 id={`${id}-start-over`} className="font-display text-2xl">
            Start over?
          </h2>
          <p id={`${id}-start-over-help`} className="text-sm text-ink-muted">
            This removes all {pageCount} {pageCount === 1 ? 'page' : 'pages'} and their undo
            history, and clears the password. It can't be undone. Your page setup is kept.
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
