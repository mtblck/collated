import { Button } from './controls'
import { TrashIcon } from './Icons'

/**
 * Above the pages when some look blank (#68): how many, a way to select
 * them (to check, or to keep one by deselecting it), and Remove, which says
 * the count before it's pressed and is one undo step. Never automatic.
 */
export const BlankPagesBar = ({
  count,
  busy,
  onSelect,
  onRemove,
}: {
  count: number
  /** Importing: wait, so pages still arriving aren't left out. */
  busy: boolean
  onSelect: () => void
  onRemove: () => void
}) => (
  <div className="-mt-2 mb-4 flex min-h-8 flex-wrap items-center gap-x-1 gap-y-2">
    <p className="label pr-2 text-ink-muted">
      {count === 1 ? '1 page looks blank' : `${count} pages look blank`}
    </p>
    <Button size="sm" variant="quiet" onClick={onSelect}>
      {count === 1 ? 'Select it' : 'Select them'}
    </Button>
    <Button size="sm" variant="secondary" inactive={busy} onClick={onRemove}>
      <TrashIcon width={14} height={14} />
      {count === 1 ? 'Remove blank page' : `Remove ${count} blank pages`}
    </Button>
  </div>
)
