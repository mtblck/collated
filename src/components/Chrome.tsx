import { useEffect, useRef, type ReactNode } from 'react'
import { Button, IconButton } from './controls'
import { cx } from './cx'
import { CloseIcon, MoonIcon, SunIcon } from './Icons'
import { DOCS_URL, FOOTER, SOURCE_URL, SUPPORT_URL } from './links'
import { savedWhen } from './format'
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

const NAV_LINK =
  'rounded-full px-3 py-1.5 text-sm text-ink-muted hover:bg-ink/[0.06] hover:text-ink'

/** The name, set in the UI's own face: semibold, tight, lower case. */
const WORDMARK = 'text-xl leading-none font-semibold tracking-[-0.03em] text-ink lowercase'

const TrustNote = ({ className }: { className?: string }) => (
  <p className={cx('label items-center gap-2 text-ink-faint', className)}>
    <span
      className="inline-block size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--c-accent)]"
      aria-hidden="true"
    />
    Files stay on this device
  </p>
)

/**
 * One row over the table, no bar of its own. In the workspace: the
 * wordmark, the toolbar (`children`) as a floating pill in the middle, and
 * the privacy note; on the landing view, the note and links. It never
 * scrolls away: on a wide screen the panes below scroll instead (see App).
 */
export const Header = ({ children }: { children?: ReactNode }) => (
  <header className="relative z-20 shrink-0">
    {children !== undefined ? (
      <div className="mx-auto flex min-h-16 max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:px-6">
        {/* While working on a phone the toolbar needs the room. */}
        <span className={cx(WORDMARK, 'max-sm:sr-only')}>Collated</span>
        {children}
        <TrustNote className="hidden justify-self-end xl:flex" />
      </div>
    ) : (
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <span className={WORDMARK}>Collated</span>
        <TrustNote className="ml-auto hidden md:flex" />
        <nav aria-label="About Collated" className="ml-auto flex items-center gap-1 md:ml-4">
          <a className={NAV_LINK} href={DOCS_URL}>
            Docs
          </a>
          <a className={NAV_LINK} href={SOURCE_URL} rel="noopener noreferrer" target="_blank">
            Source<span className="sr-only"> code (opens in a new tab)</span>
          </a>
          <a className={NAV_LINK} href={SUPPORT_URL} rel="noopener noreferrer" target="_blank">
            Support<span className="sr-only"> Collated (opens in a new tab)</span>
          </a>
          <ThemeToggle />
        </nav>
      </div>
    )}
  </header>
)

/** A page lying on the table, drawn in CSS: lines of text and a margin. */
const Sheet = ({ className, lines = 11 }: { className: string; lines?: number }) => (
  <div className={cx('sheet absolute flex flex-col gap-[6%] overflow-hidden p-[11%]', className)}>
    {Array.from({ length: lines }, (_, i) => (
      <span
        key={i}
        className="h-[3%] min-h-1 rounded-full bg-[#2a2c31]/55"
        style={{ width: `${[92, 100, 86, 97, 74, 100, 90, 95, 62, 100, 88, 79, 96, 54][i % 14]}%` }}
      />
    ))}
  </div>
)

export interface RestoreOfferProps {
  pages: number
  savedAt: number
  /** Restoring is under way (reading the bytes back). */
  busy: boolean
  onRestore: () => void
  onDiscard: () => void
}

/**
 * The document kept on this device from last time (#74), offered before
 * anything else on the landing view. A region, so it can be found by
 * landmark; Restore comes first, as the likely choice.
 */
export const RestoreOffer = ({ pages, savedAt, busy, onRestore, onDiscard }: RestoreOfferProps) => (
  <section
    aria-labelledby="restore-title"
    className="flex flex-col gap-4 rounded-[1.125rem] bg-paper p-5 shadow-panel sm:flex-row sm:items-center sm:justify-between sm:p-6"
  >
    <div className="flex flex-col gap-1">
      <h2 id="restore-title" className="text-lg font-semibold tracking-tight text-ink">
        Restore your last document?
      </h2>
      <p className="text-sm text-ink-muted">
        {pages} {pages === 1 ? 'page' : 'pages'}, saved on this device {savedWhen(savedAt)}. Undo
        history comes back too; the password doesn’t.
      </p>
    </div>
    <div className="flex shrink-0 gap-2">
      <Button variant="primary" onClick={onRestore} inactive={busy}>
        {busy ? 'Restoring…' : 'Restore'}
      </Button>
      <Button onClick={onDiscard} inactive={busy}>
        Discard
      </Button>
    </div>
  </section>
)

export const EmptyState = ({
  onChoose,
  restore,
}: {
  onChoose: () => void
  restore?: RestoreOfferProps | null
}) => (
  <div className="mx-auto flex max-w-6xl flex-col gap-14 px-4 pt-10 pb-20 sm:px-6 sm:pt-16">
    {restore && <RestoreOffer {...restore} />}
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
      <div className="flex flex-col gap-6">
        <h1 className="text-display font-semibold text-ink">
          Many pages in.
          <br />
          <span className="text-ink-faint">One PDF out.</span>
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-ink-muted">
          Lay scans, phone photos and PDFs out on the table, put them in order, and take one tidy
          PDF away. It all happens in your browser.
        </p>
      </div>

      {/* The drop target: an empty patch of the light table. */}
      <div className="relative flex flex-col items-center gap-5 overflow-hidden rounded-[1.75rem] border border-dashed border-control/70 bg-[radial-gradient(ellipse_at_50%_35%,var(--c-glow),transparent_70%)] px-6 pt-10 pb-12 text-center sm:pt-12">
        <div className="relative h-44 w-64 sm:h-52 sm:w-72" aria-hidden="true">
          <Sheet className="top-4 left-3 aspect-[17/22] h-[82%] -rotate-[9deg]" />
          <Sheet className="top-6 right-2 aspect-[17/22] h-[82%] rotate-[8deg]" lines={8} />
          <Sheet className="top-0 left-1/2 aspect-[17/22] h-[92%] -translate-x-1/2" />
        </div>
        <p className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Drop scans, photos or PDFs here
        </p>
        {/* Where focus goes when the last page is removed. */}
        <Button variant="primary" size="lg" onClick={onChoose} data-focus-fallback>
          Choose files
        </Button>
        <p className="text-sm text-ink-muted">or paste them from the clipboard</p>
        <p className="label text-ink-faint">PDF · JPEG · PNG · HEIC · WebP · AVIF · GIF</p>
      </div>
    </div>

    <ol className="grid gap-4 sm:grid-cols-3">
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
        <li key={title} className="rounded-[1.125rem] bg-paper p-6 shadow-panel">
          <p className="label text-accent">{String(i + 1).padStart(2, '0')}</p>
          <h2 className="mt-3 text-lg font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{body}</p>
        </li>
      ))}
    </ol>
    <p className="text-sm text-ink-muted">
      Nothing is uploaded: there is no server, no account and no tracking. Open source under the MIT
      licence.
    </p>
  </div>
)

/** Landing-view footer; the docs pages render the same columns (docs-site.ts). */
export const Footer = () => (
  <footer className="border-t border-rule">
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
      {FOOTER.map((column) => (
        <div key={column.title}>
          <h2 className="label mb-3 text-ink-faint">{column.title}</h2>
          <ul className="flex flex-col gap-2">
            {column.links.map((link) => (
              <li key={link.href}>
                <a
                  className="text-sm text-ink-muted hover:text-ink"
                  href={link.href}
                  {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                >
                  {link.label}
                  {link.external && <span className="sr-only"> (opens in a new tab)</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </footer>
)

export const DropOverlay = ({ active }: { active: boolean }) =>
  active ? (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ground/80 p-6 backdrop-blur-sm"
      aria-hidden="true"
    >
      <div className="flex size-full items-center justify-center rounded-[1.75rem] border-2 border-dashed border-accent bg-accent-dim">
        <p className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
          Drop to add pages
        </p>
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
      className="fixed right-4 bottom-4 z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border-l-4 border-l-accent bg-paper text-sm text-ink shadow-panel"
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
