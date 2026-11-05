import { useEffect, useId, useRef, useState } from 'react'
import { useTouchDevice } from '../hooks/useTouchDevice'
import { cx } from './cx'
import { Button } from './controls'

/**
 * Asks for the password of a PDF being added (#114). The password opens the
 * file once, in this browser, and is forgotten: an unlocked copy is what's
 * kept. Cancel (or Escape) skips the file.
 */
export const PdfPasswordPrompt = ({
  name,
  wrong,
  onAnswer,
}: {
  name: string
  /** The last password given didn't open it. */
  wrong: boolean
  /** The password, or null to skip the file. */
  onAnswer: (password: string | null) => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const given = useRef<string | null>(null)
  const [password, setPassword] = useState('')
  const [shown, setShown] = useState(false)
  // Finger-sized on phones and tablets (44px).
  const size = useTouchDevice() ? 'lg' : 'md'
  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
      onClose={() => {
        // Escape counts as Cancel.
        onAnswer(given.current)
      }}
    >
      <form
        className="flex flex-col gap-4 p-5 sm:p-6"
        // Enter (or Done on a phone's keyboard) opens it, like the button.
        onSubmit={(event) => {
          event.preventDefault()
          if (!password) {
            input.current?.focus()
            return
          }
          given.current = password
          dialog.current?.close()
        }}
      >
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          Password for {name}
        </h2>
        <p id={`${id}-help`} className="text-sm text-ink-muted">
          This PDF needs a password to open. Collated opens it here, in your browser, and keeps an
          unlocked copy of its pages with your work; the password isn’t kept.
        </p>
        <div>
          <label htmlFor={`${id}-input`} className="label mb-2 block text-ink-faint">
            Password
          </label>
          <div className="flex gap-2">
            <input
              ref={input}
              id={`${id}-input`}
              type={shown ? 'text' : 'password'}
              // 16px on touch screens, so phones don't zoom in on focus.
              className={cx('field min-w-0 flex-1', size === 'lg' && 'h-11 text-base')}
              value={password}
              // The file's own password: let a password manager fill it, but
              // nothing here offers to save it.
              autoComplete="current-password"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="done"
              aria-invalid={wrong ? true : undefined}
              aria-describedby={wrong ? `${id}-wrong` : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
              }}
            />
            <Button
              size={size}
              aria-pressed={shown}
              aria-controls={`${id}-input`}
              onClick={() => {
                setShown((s) => !s)
              }}
            >
              Show <span className="sr-only">password</span>
            </Button>
          </div>
          {wrong && (
            <p id={`${id}-wrong`} className="mt-1.5 text-xs text-accent" role="alert">
              That password didn’t open it. Try again.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            size={size}
            onClick={() => {
              given.current = null
              dialog.current?.close()
            }}
          >
            Skip this file
          </Button>
          <Button type="submit" variant="primary" size={size} inactive={!password}>
            Open
          </Button>
        </div>
      </form>
    </dialog>
  )
}
