import {
  OVERLAP_MAX,
  POSTER_SHEETS_MAX,
  bookletOrder,
  printCount,
  type PrintKind,
  type PrintOptions,
  type PrintPaper,
} from '../core/impose'
import type { Unit } from '../core/model'
import { PAGE_SIZES } from '../core/pageSizes'
import { fromPoints, roundForUnit, toPoints } from '../core/units'
import { cx } from './cx'
import { NumberField } from './NumberField'

const KINDS: readonly { value: PrintKind; label: string }[] = [
  { value: 'pages', label: 'Pages' },
  { value: 'booklet', label: 'Booklet' },
  { value: 'poster', label: 'Poster' },
]

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/** A sketch of the first sheet: a booklet's two halves, or a poster's grid. */
const Sketch = ({ print, pageCount }: { print: PrintOptions; pageCount: number }) => {
  if (print.kind === 'booklet') {
    const [[left, right] = [null, null]] = bookletOrder(pageCount)
    return (
      <svg viewBox="0 0 84 60" className="h-14 w-auto shrink-0 text-ink-faint" aria-hidden="true">
        <rect x="1" y="1" width="82" height="58" rx="2" fill="none" stroke="currentColor" />
        <line x1="42" y1="1" x2="42" y2="59" stroke="currentColor" strokeDasharray="3 2" />
        <text x="21" y="35" textAnchor="middle" fontSize="12" fill="currentColor">
          {left === null ? '' : String(left + 1)}
        </text>
        <text x="63" y="35" textAnchor="middle" fontSize="12" fill="currentColor">
          {right === null ? '' : String(right + 1)}
        </text>
      </svg>
    )
  }
  const w = 84 / print.across
  const h = 60 / print.down
  return (
    <svg viewBox="0 0 86 62" className="h-14 w-auto shrink-0 text-ink-faint" aria-hidden="true">
      {Array.from({ length: print.down }, (_, row) =>
        Array.from({ length: print.across }, (_, col) => (
          <rect
            key={`${String(row)}-${String(col)}`}
            x={1 + col * w}
            y={1 + row * h}
            width={w}
            height={h}
            rx="1"
            fill="none"
            stroke="currentColor"
          />
        )),
      )}
    </svg>
  )
}

/**
 * Print as a booklet or a poster (#119), in Export options: the kind as
 * three thumb-sized choices, then only what that kind needs. The sheet
 * count is worked out here, as it would print.
 */
export const PrintLayout = ({
  id,
  print,
  onPrint,
  pageCounts,
  unit,
}: {
  id: string
  print: PrintOptions
  onPrint: (patch: Partial<PrintOptions>) => void
  /** Pages in each file the export makes. */
  pageCounts: readonly number[]
  unit: Unit
}) => {
  const pageCount = pageCounts.reduce((a, b) => a + b, 0)
  const sheets = pageCounts.reduce((n, pages) => n + printCount(print, pages).sheets, 0)
  const blanks = print.kind === 'booklet' ? sheets * 4 - pageCount : 0
  const each =
    pageCounts.length > 1 ? `, each of the ${String(pageCounts.length)} files on its own` : ''
  const step = unit === 'in' ? 0.05 : 1
  const hint =
    print.kind === 'booklet'
      ? `${plural(pageCount, 'page')} on ${plural(sheets, 'sheet')}${each}, two a side${blanks ? `, with ${plural(blanks, 'blank page')} at the end` : ''}. Print on both sides, flipping on the short edge, then fold in half and staple.`
      : print.kind === 'poster'
        ? `${pageCount === 1 ? 'The page' : 'Each page'} across up to ${String(print.across)} × ${String(print.down)} sheets${each}.${
            print.cutMarks && print.overlap > 0
              ? ' Cut the marked strips off and lay each sheet over its neighbour, matching the labels.'
              : print.cutMarks
                ? ' With no overlap there’s nothing to cut, so no marks or labels.'
                : ''
          }`
        : 'Each page on its own sheet, the usual choice.'

  return (
    <fieldset className="mt-4" aria-describedby={`${id}-print-hint`}>
      <legend className="label mb-2 text-ink-faint">Print as</legend>
      <div className="grid grid-cols-3 gap-1">
        {KINDS.map((option) => (
          <label
            key={option.value}
            className={cx(
              'flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              print.kind === option.value
                ? 'border-ink bg-ink/[0.04] font-medium'
                : 'border-rule hover:bg-ink/[0.03]',
            )}
          >
            <input
              type="radio"
              id={`${id}-print-${option.value}`}
              name={`${id}-print`}
              className="accent-[var(--c-ink)]"
              value={option.value}
              checked={print.kind === option.value}
              onChange={() => {
                onPrint({ kind: option.value })
              }}
            />
            {option.label}
          </label>
        ))}
      </div>

      {print.kind !== 'pages' && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <label htmlFor={`${id}-paper`} className="label mb-2 block text-ink-faint">
                Paper
              </label>
              <select
                id={`${id}-paper`}
                className="field w-full"
                value={print.paper}
                onChange={(event) => {
                  onPrint({ paper: event.target.value as PrintPaper })
                }}
              >
                <option value="document">Same as the pages</option>
                {PAGE_SIZES.map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.label}
                  </option>
                ))}
              </select>
            </div>
            <Sketch print={print} pageCount={pageCounts[0] ?? 0} />
          </div>

          {print.kind === 'poster' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {(['across', 'down'] as const).map((axis) => (
                  <div key={axis}>
                    <label
                      htmlFor={`${id}-poster-${axis}`}
                      className="label mb-2 block text-ink-faint"
                    >
                      {axis === 'across' ? 'Sheets across' : 'Sheets down'}
                    </label>
                    <select
                      id={`${id}-poster-${axis}`}
                      className="field w-full"
                      value={print[axis]}
                      onChange={(event) => {
                        onPrint({ [axis]: Number(event.target.value) })
                      }}
                    >
                      {Array.from({ length: POSTER_SHEETS_MAX }, (_, i) => (
                        <option key={i} value={i + 1}>
                          {String(i + 1)}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <div>
                <label htmlFor={`${id}-overlap`} className="label mb-2 block text-ink-faint">
                  Overlap
                </label>
                <NumberField
                  id={`${id}-overlap`}
                  className="w-32"
                  value={roundForUnit(fromPoints(print.overlap, unit), unit)}
                  min={0}
                  max={roundForUnit(fromPoints(OVERLAP_MAX, unit), unit)}
                  step={step}
                  suffix={unit}
                  aria-describedby={`${id}-overlap-hint`}
                  onCommit={(value) => {
                    onPrint({ overlap: toPoints(value, unit) })
                  }}
                />
                <p id={`${id}-overlap-hint`} className="mt-1.5 text-xs text-ink-muted">
                  Shared by neighbouring sheets, so the white edge printers leave is cut away.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--c-ink)]"
                  checked={print.cutMarks}
                  onChange={(event) => {
                    onPrint({ cutMarks: event.target.checked })
                  }}
                />
                Cut marks and sheet labels
              </label>
            </>
          )}
        </div>
      )}

      <p id={`${id}-print-hint`} role="status" className="mt-1.5 text-xs text-ink-muted">
        {hint}
        {print.kind !== 'pages' ? ' No bookmarks: the pages are on sheets now.' : ''}
      </p>
    </fieldset>
  )
}
