import { useState, type KeyboardEvent } from 'react'
import { cx } from './cx'

/**
 * A number input that lets you type freely (including an empty or partial
 * value). Complete in-range values apply as you type; anything else is parsed
 * and clamped on blur or Enter. Escape restores the last committed value.
 */
export const NumberField = ({
  id,
  value,
  onCommit,
  onClear,
  min,
  max,
  step = 1,
  suffix,
  className,
  ...aria
}: {
  id: string
  /** null shows an empty field (for optional values). */
  value: number | null
  onCommit: (value: number) => void
  /** Called when the field is committed empty; without it, empty restores the value. */
  onClear?: () => void
  min: number
  max: number
  step?: number
  suffix?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
}) => {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (value === null ? '' : String(value))

  const commit = () => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft.replace(',', '.'))
    setDraft(null)
    if (draft.trim() === '' && onClear) {
      onClear()
      return
    }
    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setDraft(null)
  }

  return (
    <div className={cx('relative', className)}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className={cx('field w-full', suffix && 'pr-9')}
        value={shown}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          // Live-update while the value is complete and in range (spinner
          // clicks, arrow keys); partial input waits for blur or Enter.
          const parsed = Number.parseFloat(text)
          if (text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
            onCommit(parsed)
          }
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
        {...aria}
      />
      {suffix && (
        <span
          className="label pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ink-faint normal-case"
          aria-hidden="true"
        >
          {suffix}
        </span>
      )}
    </div>
  )
}
