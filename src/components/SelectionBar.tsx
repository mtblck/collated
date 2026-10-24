import { Button } from './controls'

/**
 * Above the pages (#65): Select mode for touch, where a tap adds or removes
 * a page, and select all / clear while several are selected.
 */
export const SelectionBar = ({
  count,
  selected,
  selecting,
  onSelecting,
  onSelectAll,
  onClear,
}: {
  count: number
  selected: number
  selecting: boolean
  onSelecting: (on: boolean) => void
  onSelectAll: () => void
  onClear: () => void
}) => {
  const several = selecting || selected > 1
  return (
    <div className="mb-4 flex min-h-8 flex-wrap items-center gap-x-1 gap-y-2">
      <Button
        size="sm"
        variant={selecting ? 'primary' : 'quiet'}
        className="-ml-3"
        aria-pressed={selecting}
        onClick={() => {
          onSelecting(!selecting)
        }}
      >
        Select
      </Button>
      {several && (
        <>
          <p className="label px-2 text-ink-muted" aria-hidden="true">
            {selected} selected
          </p>
          <Button size="sm" variant="quiet" inactive={selected === count} onClick={onSelectAll}>
            Select all
          </Button>
          <Button size="sm" variant="quiet" inactive={selected === 0} onClick={onClear}>
            Select none
          </Button>
        </>
      )}
    </div>
  )
}
