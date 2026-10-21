import { useId, useRef, type ReactNode } from 'react'
import { cx } from './cx'
import { MoonIcon, MoreIcon, RotateLeftIcon, RotateRightIcon, SunIcon } from './Icons'
import { SOURCE_URL, SUPPORT_URL } from './links'
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
 * Everything the toolbar doesn't need on show: whole-document rotation, the
 * theme, and links out. A disclosure (a popover of ordinary buttons and
 * links, Tab to move), not an ARIA menu: menus promise arrow-key behaviour
 * and roles screen readers treat differently, for no gain here.
 */
export const MoreMenu = ({
  pageCount,
  onRotateAll,
}: {
  pageCount: number
  onRotateAll: (by: -1 | 1) => void
}) => {
  const id = useId()
  const panelId = `${id}-more`
  const panel = useRef<HTMLDivElement>(null)
  useCloseOnFocusOut(panel, panelId)
  const { theme, next, toggle } = useTheme()

  return (
    <>
      <button
        type="button"
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
          <Group label="All pages">
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
    </>
  )
}
