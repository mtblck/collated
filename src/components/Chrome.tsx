import { useEffect, useRef, type ReactNode } from 'react'
import { Button, IconButton } from './controls'
import { cx } from './cx'
import { CloseIcon, MoonIcon, SunIcon } from './Icons'
import { SOURCE_URL, SUPPORT_URL } from './links'
import { useTheme } from './theme'

/** The landing view's theme switch; in the workspace it lives in More. */
const ThemeToggle = () => {
  const { theme, next, toggle } = useTheme()
  return (
    <IconButton label={`Use ${next} theme`} onClick={toggle}>
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  )
}

const NAV_LINK = 'px-2 py-1 text-sm text-ink-muted hover:text-ink'

/**
 * One row. The wordmark, then either the workspace toolbar (`children`) or,
 * on the landing view, the privacy note and links. It never scrolls away:
 * on a wide screen the panes below scroll instead (see App).
 */
export const Header = ({ children }: { children?: ReactNode }) => (
  <header className="relative z-20 shrink-0 border-b border-rule bg-paper">
    <div className="mx-auto flex min-h-14 max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
      {/* While working on a phone the toolbar needs the room; the landing
          view always shows the name. */}
      <span
        className={cx(
          'font-display text-[1.75rem] leading-none text-ink',
          children !== undefined && 'max-sm:sr-only',
        )}
      >
        Collated
      </span>
      {children ?? (
        <>
          <p className="label ml-auto hidden text-ink-faint md:block">
            <span
              className="mr-2 inline-block size-1.5 rounded-full bg-accent align-middle"
              aria-hidden="true"
            />
            Files stay on this device
          </p>
          <nav aria-label="About Collated" className="ml-auto flex items-center gap-1 md:ml-4">
            <a className={NAV_LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
              Source<span className="sr-only"> code (opens in a new tab)</span>
            </a>
            <a className={NAV_LINK} href={SUPPORT_URL} rel="noopener noreferrer" target="_blank">
              Support<span className="sr-only"> Collated (opens in a new tab)</span>
            </a>
            <ThemeToggle />
          </nav>
        </>
      )}
    </div>
  </header>
)

export const EmptyState = ({ onChoose }: { onChoose: () => void }) => (
  <div className="mx-auto flex max-w-5xl flex-col gap-12 px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
    <h1 className="font-display text-display text-ink">
      Many pages in.
      <br />
      <em className="text-ink-muted">One PDF out.</em>
    </h1>

    <div className="crop-marks p-2">
      <div className="flex flex-col items-center gap-5 bg-paper-sunk px-6 py-16 text-center sm:py-24">
        <p className="font-display text-3xl text-ink sm:text-4xl">
          Drop scans, photos or PDFs here
        </p>
        {/* Where focus goes when the last page is removed. */}
        <Button variant="primary" size="lg" onClick={onChoose} data-focus-fallback>
          Choose files
        </Button>
        <p className="text-sm text-ink-muted">or paste them from the clipboard</p>
        <p className="label mt-2 text-ink-faint">PDF · JPEG · PNG · HEIC · WebP · AVIF · GIF</p>
      </div>
    </div>

    <ol className="grid gap-8 border-t border-rule pt-8 sm:grid-cols-3">
      {[
        [
          'Add',
          'Drop in every page at once, images or whole PDFs. Phone photos come in the right way up.',
        ],
        [
          'Arrange',
          'Drag to reorder. Rotate, straighten and scale each page; pick the paper size.',
        ],
        [
          'Export',
          'One PDF, built in your browser. Scanned JPEGs go in as they are, not recompressed.',
        ],
      ].map(([title, body], i) => (
        <li key={title}>
          <p className="label text-accent">{String(i + 1).padStart(2, '0')}</p>
          <h2 className="mt-3 font-display text-2xl text-ink">{title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
        </li>
      ))}
    </ol>
    <p className="text-sm text-ink-muted">
      Nothing is uploaded: there is no server, no account and no tracking. Open source under the MIT
      licence.
    </p>
  </div>
)

export const DropOverlay = ({ active }: { active: boolean }) =>
  active ? (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-paper/80 p-6 backdrop-blur-sm"
      aria-hidden="true"
    >
      <div className="flex size-full items-center justify-center border-2 border-dashed border-accent">
        <p className="font-display text-4xl text-ink sm:text-5xl">Drop to add pages</p>
      </div>
    </div>
  ) : null

export interface Notice {
  id: number
  text: string
}

/**
 * Messages that need reading (failed imports, export problems). They stay
 * until dismissed — by button, or Escape (handled by the app) — and only the
 * latest is shown, with a count of the rest, so a burst of failures doesn't
 * stack up over the page on a phone. While one is up, the page reserves room
 * below its content and scrolls focused controls clear of it (WCAG 2.4.11).
 */
export const Notices = ({
  items,
  onDismiss,
  onDismissAll,
}: {
  items: Notice[]
  onDismiss: (id: number) => void
  onDismissAll: () => void
}) => {
  const box = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const latest = items.at(-1)
  const more = items.length - 1

  useEffect(() => {
    const el = box.current
    const root = document.documentElement
    if (!el) return
    const reserve = () => {
      const room = `${Math.ceil(el.getBoundingClientRect().height) + 24}px`
      root.style.scrollPaddingBottom = room
      document.body.style.paddingBottom = room
      // The scrolling panes (index.css .scroll-pane) keep the same room.
      root.style.setProperty('--notice-room', room)
    }
    reserve()
    // Remember where focus came from, to give it back on dismissal.
    const onFocusIn = (event: FocusEvent) => {
      const from = event.relatedTarget
      if (from instanceof HTMLElement && !el.contains(from)) returnTo.current = from
    }
    el.addEventListener('focusin', onFocusIn)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reserve)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      el.removeEventListener('focusin', onFocusIn)
      root.style.scrollPaddingBottom = ''
      document.body.style.paddingBottom = ''
      root.style.removeProperty('--notice-room')
    }
  }, [latest])

  if (!latest) return null
  // Dismissing the last message removes the box; give focus back to where it
  // came from rather than dropping it to the page.
  const leave = (then: () => void) => {
    const back = returnTo.current
    if (items.length === 1 || then === onDismissAll) {
      if (back?.isConnected) back.focus()
      else document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus()
    }
    then()
  }
  return (
    <div
      ref={box}
      className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] border border-l-2 border-rule border-l-accent bg-paper text-sm text-ink shadow-lg"
    >
      <div className="flex items-start gap-3 py-2 pr-2 pl-4">
        {/* Keyed so each new message is a new alert, and announced. */}
        <p key={latest.id} role="alert" className="flex-1 pt-2">
          {latest.text}
        </p>
        <IconButton
          label={more > 0 ? 'Dismiss this message' : 'Dismiss'}
          onClick={() => {
            leave(() => {
              onDismiss(latest.id)
            })
          }}
        >
          <CloseIcon width={16} height={16} />
        </IconButton>
      </div>
      {more > 0 && (
        <div className="flex items-center justify-between gap-3 border-t border-rule-soft py-1 pr-2 pl-4">
          <p className="text-xs text-ink-muted">
            and {more} earlier {more === 1 ? 'message' : 'messages'}
          </p>
          <Button
            variant="quiet"
            onClick={() => {
              leave(onDismissAll)
            }}
          >
            Dismiss all
          </Button>
        </div>
      )}
    </div>
  )
}
