import type { SheetLayout } from '../core/geometry'
import { NUMBER_GREY, type NumberMark } from '../core/pageNumbers'
import { cx } from './cx'

const pct = (part: number, whole: number) => `${(part / whole) * 100}%`

/**
 * A page drawn from the same layout the PDF export uses, so the preview is the
 * output: the image is centred on the printable area, rotated with CSS (both
 * are clockwise in y-down space) and clipped to the margins.
 *
 * The sheet is fitted to its box with container-query units, so it keeps the
 * page's exact aspect whatever padding the box has. A combined page (#76)
 * draws each picture the same way, clipped to its cell.
 */
export const PagePreview = ({
  sheet,
  thumbUrls,
  showMargins = false,
  selected = false,
  mark = null,
  className,
}: {
  sheet: SheetLayout
  /** One per picture, in `sheet.pictures` order. */
  thumbUrls: readonly string[]
  showMargins?: boolean
  /** Rings the sheet itself: the page, not its card, is what's selected. */
  selected?: boolean
  /** The page number to draw, placed exactly as the export places it. */
  mark?: NumberMark | null
  className?: string
}) => {
  const { page, content } = sheet
  const single = sheet.pictures.length === 1
  const guide = (rect: { x: number }) =>
    showMargins &&
    rect.x > 0 &&
    'outline outline-1 outline-offset-0 outline-[#9a8f84]/40 outline-dashed'
  return (
    <div
      className={cx('flex h-full w-full items-center justify-center', className)}
      style={{ containerType: 'size' }}
    >
      <div
        className={cx(
          'sheet relative transition-[outline-color]',
          selected ? 'outline-2 outline-offset-4 outline-accent' : 'outline-transparent',
        )}
        style={{
          // As wide as the box allows, or as the box's height at the page's aspect.
          width: `min(100cqw, ${String(page.width / page.height)} * 100cqh)`,
          aspectRatio: `${page.width} / ${page.height}`,
          containerType: 'size',
        }}
      >
        {/* On a combined page the margins get their own guide; the cells
            only clip. */}
        {!single && showMargins && (
          <div
            data-margin-guide
            aria-hidden="true"
            className={cx('pointer-events-none absolute', guide(content))}
            style={{
              left: pct(content.x, page.width),
              top: pct(content.y, page.height),
              width: pct(content.width, page.width),
              height: pct(content.height, page.height),
            }}
          />
        )}
        {sheet.pictures.map(({ content: cell, image }, i) => (
          <div
            // A cell is its position on the sheet.
            key={i}
            data-margin-guide={(single && showMargins) || undefined}
            className={cx('absolute overflow-hidden', single && guide(cell))}
            style={{
              left: pct(cell.x, page.width),
              top: pct(cell.y, page.height),
              width: pct(cell.width, page.width),
              height: pct(cell.height, page.height),
            }}
          >
            <img
              src={thumbUrls[i]}
              alt=""
              draggable={false}
              decoding="async"
              className="absolute max-w-none select-none"
              style={{
                left: pct(image.cx - cell.x, cell.width),
                top: pct(image.cy - cell.y, cell.height),
                width: pct(image.width, cell.width),
                height: pct(image.height, cell.height),
                transform: `translate(-50%, -50%) rotate(${image.rotation}deg)`,
              }}
            />
          </div>
        ))}
        {mark && (
          <span
            aria-hidden="true"
            className="absolute leading-none whitespace-nowrap"
            style={{
              left: pct(mark.x, page.width),
              top: pct(mark.baseline, page.height),
              // Container-query height units: the type scales with the sheet
              // exactly as the PDF's points scale with the page.
              fontSize: `${(mark.size / page.height) * 100}cqh`,
              fontFamily: 'Helvetica, Arial, sans-serif',
              color: `rgb(${Math.round(NUMBER_GREY * 255)} ${Math.round(NUMBER_GREY * 255)} ${Math.round(NUMBER_GREY * 255)})`,
              // Anchor on the baseline: shift up by the ascent (~0.72 em for Helvetica).
              transform: `translate(${mark.align === 'center' ? '-50%' : '-100%'}, -0.72em)`,
            }}
          >
            {mark.text}
          </span>
        )}
      </div>
    </div>
  )
}
