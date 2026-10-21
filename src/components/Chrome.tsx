import { useEffect, useState } from 'react'
import { Button, IconButton } from './controls'
import { CloseIcon, MoonIcon, SunIcon } from './Icons'

type Theme = 'light' | 'dark'

const currentTheme = (): Theme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'

/** Same storage key as mattblack.space, which shares this origin in production. */
const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(currentTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const next: Theme = theme === 'dark' ? 'light' : 'dark'
  return (
    <IconButton
      label={`Use ${next} theme`}
      onClick={() => {
        setTheme(next)
        try {
          localStorage.setItem('mb-theme', next)
        } catch {
          /* private mode: the choice lasts for this page only */
        }
      }}
    >
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </IconButton>
  )
}

export const Header = () => (
  <header className="border-b border-rule">
    <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-3 sm:px-6">
      <a href="/tools/collated/" className="flex items-baseline gap-3">
        <span className="font-display text-[1.75rem] leading-none text-ink">Collated</span>
        <span className="label hidden text-ink-faint sm:inline">Scans → one PDF</span>
      </a>
      <p className="label ml-auto hidden text-ink-faint md:block">
        <span
          className="mr-2 inline-block size-1.5 rounded-full bg-accent align-middle"
          aria-hidden="true"
        />
        Files stay on this device
      </p>
      <nav aria-label="Elsewhere" className="ml-auto flex items-center gap-1 md:ml-4">
        <a
          className="px-2 py-1 text-sm text-ink-muted hover:text-ink"
          href="https://github.com/mtblck/collated"
          rel="noopener noreferrer"
          target="_blank"
        >
          Source
        </a>
        <a
          className="px-2 py-1 text-sm text-ink-muted hover:text-ink"
          href="https://mattblack.space/"
        >
          Matt Black
        </a>
        <ThemeToggle />
      </nav>
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
        <Button variant="primary" size="lg" onClick={onChoose}>
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
          'One PDF, built in your browser. Scanned JPEGs go in untouched, never recompressed.',
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

export const Notices = ({
  items,
  onDismiss,
}: {
  items: Notice[]
  onDismiss: (id: number) => void
}) =>
  items.length > 0 ? (
    <div className="fixed right-4 bottom-4 z-40 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {items.map((notice) => (
        <div
          key={notice.id}
          role="alert"
          className="flex items-start gap-3 border border-l-2 border-rule border-l-accent bg-paper py-3 pr-2 pl-4 text-sm text-ink shadow-lg"
        >
          <p className="flex-1 pt-1.5">{notice.text}</p>
          <IconButton
            label="Dismiss"
            onClick={() => {
              onDismiss(notice.id)
            }}
          >
            <CloseIcon width={16} height={16} />
          </IconButton>
        </div>
      ))}
    </div>
  ) : null
