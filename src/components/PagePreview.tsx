import type { Layout } from '../core/geometry'
import { cx } from './cx'

const pct = (part: number, whole: number) => `${(part / whole) * 100}%`

/**
 * A page drawn from the same layout the PDF export uses, so the preview is the
 * output: the image is centred on the printable area, rotated with CSS (both
 * are clockwise in y-down space) and clipped to the margins.
 *
 * The sheet is sized to fit a box of aspect `boxRatio` (width / height).
 */
export const PagePreview = ({
  layout,
  thumbUrl,
  boxRatio,
  showMargins = false,
  selected = false,
  className,
}: {
  layout: Layout
  thumbUrl: string
  boxRatio: number
  showMargins?: boolean
  /** Rings the sheet itself: the page, not its card, is what's selected. */
  selected?: boolean
  className?: string
}) => {
  const { page, content, image } = layout
  const wide = page.width / page.height > boxRatio
  return (
    <div className={cx('flex h-full w-full items-center justify-center', className)}>
      <div
        className={cx(
          'sheet relative transition-[outline-color]',
          wide ? 'h-auto w-full' : 'h-full w-auto',
          selected ? 'outline-2 outline-offset-4 outline-accent' : 'outline-transparent',
        )}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
      >
        <div
          className={cx(
            'absolute overflow-hidden',
            showMargins &&
              content.x > 0 &&
              'outline outline-1 outline-offset-0 outline-[#9a8f84]/40 outline-dashed',
          )}
          style={{
            left: pct(content.x, page.width),
            top: pct(content.y, page.height),
            width: pct(content.width, page.width),
            height: pct(content.height, page.height),
          }}
        >
          <img
            src={thumbUrl}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute max-w-none select-none"
            style={{
              left: pct(image.cx - content.x, content.width),
              top: pct(image.cy - content.y, content.height),
              width: pct(image.width, content.width),
              height: pct(image.height, content.height),
              transform: `translate(-50%, -50%) rotate(${image.rotation}deg)`,
            }}
          />
        </div>
      </div>
    </div>
  )
}
