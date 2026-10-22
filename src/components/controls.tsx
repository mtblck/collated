import { useId, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

// `aria-disabled:` mirrors `disabled:` for buttons that stay focusable (`inactive`).
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink/85 disabled:bg-ink/30 disabled:text-paper/80 aria-disabled:bg-ink/30 aria-disabled:text-paper/80 border border-transparent',
  secondary:
    'border border-rule bg-paper text-ink hover:border-ink-faint disabled:text-ink-faint disabled:hover:border-rule aria-disabled:text-ink-faint aria-disabled:hover:border-rule',
  // Destructive actions: the accent behind paper-coloured text (AA in both themes).
  danger:
    'border border-transparent bg-accent text-paper hover:bg-accent/90 disabled:opacity-50 aria-disabled:opacity-50',
  quiet:
    'border border-transparent text-ink-muted hover:text-ink hover:bg-ink/5 disabled:text-ink-faint/60 disabled:hover:bg-transparent aria-disabled:text-ink-faint/60 aria-disabled:hover:bg-transparent',
}

/*
 * Sizes are a prop rather than class overrides: two padding utilities on one
 * element resolve by stylesheet order, not by which was written last, which
 * once squeezed every icon button's glyph to 6px wide.
 */
type Size = 'sm' | 'md' | 'lg' | 'tile' | 'icon' | 'icon-sm'

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-2 px-3 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
  /** Icon over label, for a row of equal actions in a narrow panel. */
  tile: 'h-14 flex-col gap-1 px-2 text-xs',
  lg: 'h-11 gap-2 px-6 text-base',
  icon: 'size-9',
  'icon-sm': 'size-7',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /**
   * Unavailable but still focusable: `aria-disabled`, and clicks are ignored.
   * For a button that becomes unavailable while focused (busy, or the end of
   * a list), where `disabled` would drop focus to the page.
   */
  inactive?: boolean
  ref?: Ref<HTMLButtonElement>
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  inactive = false,
  onClick,
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={cx(
      'inline-flex shrink-0 items-center justify-center rounded-[2px] font-medium whitespace-nowrap transition-colors [&>svg]:shrink-0',
      SIZES[size],
      VARIANTS[variant],
      className,
    )}
    {...(inactive ? { 'aria-disabled': true } : {})}
    onClick={(event) => {
      if (inactive) {
        event.preventDefault()
        return
      }
      onClick?.(event)
    }}
    {...props}
  />
)

/** Square icon button; the label is required and becomes the accessible name and tooltip. */
export const IconButton = ({
  label,
  small = false,
  variant = 'quiet',
  ...props
}: Omit<ButtonProps, 'aria-label' | 'size'> & {
  label: string
  small?: boolean
}) => (
  <Button
    variant={variant}
    size={small ? 'icon-sm' : 'icon'}
    aria-label={label}
    title={label}
    {...props}
  />
)

/** A labelled group of native radios that looks like a segmented control. */
export const Segmented = <T extends string>({
  legend,
  value,
  options,
  onChange,
  hideLegend = false,
  disabled = false,
  describedBy,
}: {
  legend: string
  value: T
  options: readonly { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  hideLegend?: boolean
  /** Disables every option (a disabled fieldset disables its radios natively). */
  disabled?: boolean
  describedBy?: string
}) => {
  const name = useId()
  return (
    <fieldset className="min-w-0" disabled={disabled} aria-describedby={describedBy}>
      <legend className={cx('label mb-2 text-ink-faint', hideLegend && 'sr-only')}>{legend}</legend>
      <div className="flex h-9 rounded-[2px] border border-control">
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              'relative flex flex-1 items-center justify-center px-3 text-sm whitespace-nowrap transition-colors not-first:border-l not-first:border-control',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              disabled
                ? value === option.value
                  ? 'bg-ink/15 text-ink-muted'
                  : 'text-ink-faint'
                : value === option.value
                  ? 'bg-ink text-paper'
                  : 'text-ink-muted hover:text-ink',
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => {
                onChange(option.value)
              }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Small label above a control, in the mono spec-sheet register. */
export const FieldLabel = ({ htmlFor, children }: { htmlFor: string; children: ReactNode }) => (
  <label htmlFor={htmlFor} className="label mb-2 block text-ink-faint">
    {children}
  </label>
)
