import { useId } from 'react'
import { SECTION_MAX } from '../core/outline'

/**
 * Names a section that starts at this page (#75): a bookmark in the exported
 * PDF. Typing is one undo step, like dragging a slider.
 */
export const SectionField = ({
  value,
  onChange,
  onDone,
}: {
  value: string
  onChange: (title: string) => void
  onDone: () => void
}) => {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label mb-2 block text-ink-faint">
        Section starts here
      </label>
      <input
        id={id}
        className="field w-full"
        placeholder="None"
        value={value}
        maxLength={SECTION_MAX}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        onBlur={onDone}
      />
      <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-muted">
        Optional. Becomes a bookmark in the PDF, and moves with this page.
      </p>
    </div>
  )
}
