import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink/85 disabled:bg-ink/30 disabled:text-paper/80 border border-transparent',
  secondary:
    'border border-rule bg-paper text-ink hover:border-ink-faint disabled:text-ink-faint disabled:hover:border-rule',
  quiet:
    'border border-transparent text-ink-muted hover:text-ink hover:bg-ink/5 disabled:text-ink-faint/60 disabled:hover:bg-transparent',
}

/*
 * Sizes are a prop rather than class overrides: two padding utilities on one
 * element resolve by stylesheet order, not by which was written last, which
 * once squeezed every icon button's glyph to 6px wide.
 */
type Size = 'md' | 'lg' | 'icon' | 'icon-sm'

const SIZES: Record<Size, string> = {
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'size-9',
  'icon-sm': 'size-7',
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) => (
  <button
    type={type}
    className={cx(
      'inline-flex shrink-0 items-center justify-center gap-2 rounded-[2px] font-medium whitespace-nowrap transition-colors [&>svg]:shrink-0',
      SIZES[size],
      VARIANTS[variant],
      className,
    )}
    {...props}
  />
)

/** Square icon button; the label is required and becomes the accessible name and tooltip. */
export const IconButton = ({
  label,
  small = false,
  variant = 'quiet',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  label: string
  small?: boolean
  variant?: Variant
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
}: {
  legend: string
  value: T
  options: readonly { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  hideLegend?: boolean
}) => {
  const name = useId()
  return (
    <fieldset className="min-w-0">
      <legend className={cx('label mb-2 text-ink-faint', hideLegend && 'sr-only')}>{legend}</legend>
      <div className="flex h-9 rounded-[2px] border border-rule">
        {options.map((option) => (
          <label
            key={option.value}
            className={cx(
              'relative flex flex-1 items-center justify-center px-3 text-sm whitespace-nowrap transition-colors not-first:border-l not-first:border-rule',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              value === option.value ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
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
