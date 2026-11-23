import { Button } from './controls'

/**
 * Above the pages (#65): Select mode for touch, where a tap adds or removes
 * a page, and select all / clear while several are selected; below lg,
 * Edit opens the page tools' sheet for them.
 */
export const SelectionBar = ({
  count,
  selected,
  selecting,
  onSelecting,
  onSelectAll,
  onClear,
  onOpen,
}: {
  count: number
  selected: number
  selecting: boolean
  onSelecting: (on: boolean) => void
  onSelectAll: () => void
  onClear: () => void
  /** Opens the page tools for the selection, where they're a sheet (below lg, App). */
  onOpen?: () => void
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
          {onOpen && (
            <Button
              size="sm"
              variant="secondary"
              inactive={selected === 0}
              onClick={onOpen}
              aria-label="Edit the selected pages"
            >
              Edit
            </Button>
          )}
        </>
      )}
    </div>
  )
}
