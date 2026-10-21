import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Asset } from '../core/model'
import { FULL_IMAGE, isConvex, isWholeImage, type Point, type Quad } from '../core/perspective'
import { Button } from './controls'
import { cx } from './cx'

const NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const withCorner = (quad: Quad, index: number, point: Point): Quad => {
  const next: [Point, Point, Point, Point] = [...quad]
  next[index] = { x: clamp01(point.x), y: clamp01(point.y) }
  return next
}

/** How far (px) a press can move and still count as a tap, not a drag. */
const TAP_SLOP = 6

/**
 * Drag the four corners of the paper in a photo; the page then shows that
 * quadrilateral flattened to a rectangle. A native modal dialog: focus is
 * trapped and restored, Escape cancels.
 *
 * Three ways to place a corner: drag it; tap it, then tap where it goes (a
 * single-pointer alternative to dragging, WCAG 2.5.7); or focus it and use the
 * arrow keys (Shift for 5% steps). Each corner keeps a stable name; where it
 * is goes in its description, and moves are announced in one polite region,
 * after the keys settle rather than on every press.
 */
export const CropEditor = ({
  asset,
  initial,
  onApply,
  onClose,
}: {
  asset: Pick<Asset, 'name' | 'thumbUrl' | 'width' | 'height'>
  initial: Quad | null
  onApply: (corners: Quad | null) => void
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [corners, setCorners] = useState<Quad>(initial ?? FULL_IMAGE)
  const [dragging, setDragging] = useState<number | null>(null)
  /** The corner a tap on the image will move. */
  const [picked, setPicked] = useState<number | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Where the current press started, and whether it has become a drag. */
  const press = useRef<{ x: number; y: number; moved: boolean; onCorner: boolean } | null>(null)
  const valid = isConvex(corners)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      clearTimeout(settle.current)
    }
  }, [])

  const where = (p: Point) => `${percent(p.x)} across, ${percent(p.y)} down`
  const announce = (text: string, delay = 0) => {
    clearTimeout(settle.current)
    if (delay === 0) setAnnouncement(text)
    else
      settle.current = setTimeout(() => {
        setAnnouncement(text)
      }, delay)
  }

  const pointAt = (event: PointerEvent): Point | null => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return null
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const startPress = (event: PointerEvent, onCorner: boolean) => {
    press.current = { x: event.clientX, y: event.clientY, moved: false, onCorner }
  }
  const pressMoved = (event: PointerEvent) => {
    const p = press.current
    if (p && !p.moved && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TAP_SLOP) {
      p.moved = true
    }
    return p?.moved ?? false
  }

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.05 : 0.005
    const move: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const delta = move[event.key]
    if (!delta) return
    event.preventDefault()
    const p = corners[index] ?? { x: 0, y: 0 }
    const next = withCorner(corners, index, { x: p.x + delta.x, y: p.y + delta.y })
    setCorners(next)
    announce(`${NAMES[index] ?? ''} corner, ${where(next[index] ?? p)}.`, 300)
  }

  const outline = corners.map((p) => `${p.x * asset.width},${p.y * asset.height}`).join(' ')

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto border border-rule bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/50"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <h2 id={`${id}-title`} className="font-display text-3xl">
            Crop to the page
          </h2>
          <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
            Drag each corner onto a corner of the paper, or tap a corner and then tap where it goes;
            it will be flattened into a straight rectangle. With a keyboard, focus a corner and use
            the arrow keys (hold Shift for bigger steps).
          </p>
        </div>

        <div className="flex justify-center bg-paper-sunk p-4 sm:p-6">
          <div
            ref={stage}
            className={cx('relative touch-none select-none', picked !== null && 'cursor-crosshair')}
            style={{
              aspectRatio: `${asset.width} / ${asset.height}`,
              width: `min(100%, calc(60dvh * ${asset.width / asset.height}))`,
            }}
            onPointerDown={(event) => {
              if (!(event.target instanceof Element && event.target.closest('button'))) {
                startPress(event, false)
              }
            }}
            onPointerMove={(event) => {
              if (!pressMoved(event) || dragging === null) return
              const p = pointAt(event)
              if (p) setCorners(withCorner(corners, dragging, p))
            }}
            onPointerUp={(event) => {
              const onImage = press.current !== null && !press.current.onCorner
              const tap = onImage && !pressMoved(event)
              // A press on a corner is left for its click to read.
              if (onImage) press.current = null
              setDragging(null)
              // Tap-to-place: the picked corner goes where the image was tapped.
              if (!tap || picked === null) return
              const at = pointAt(event)
              if (!at) return
              const next = withCorner(corners, picked, at)
              setCorners(next)
              setPicked(null)
              announce(`${NAMES[picked] ?? ''} corner moved to ${where(next[picked] ?? at)}.`)
            }}
          >
            <img
              src={asset.thumbUrl}
              alt={`The whole of ${asset.name}`}
              className="block size-full"
              draggable={false}
            />
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox={`0 0 ${asset.width} ${asset.height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {/* Dim everything outside the crop. */}
              <path
                d={`M0 0H${asset.width}V${asset.height}H0Z M${outline.replaceAll(' ', ' L')}Z`}
                fillRule="evenodd"
                fill="rgb(20 18 16 / 0.55)"
              />
              {/* Two-tone, so the outline shows on light paper and dark
                  surroundings alike, in either theme (WCAG 1.4.11). */}
              <polygon
                points={outline}
                fill="none"
                stroke="rgb(20 18 16)"
                strokeWidth={4}
                vectorEffect="non-scaling-stroke"
              />
              <polygon
                points={outline}
                fill="none"
                stroke={valid ? 'var(--c-accent)' : '#f33'}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {corners.map((p, index) => (
              <button
                key={NAMES[index]}
                type="button"
                className={cx(
                  'absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full active:cursor-grabbing',
                  'focus-visible:outline-offset-0',
                )}
                style={{ left: percent(p.x), top: percent(p.y) }}
                aria-label={`${NAMES[index] ?? ''} corner`}
                aria-describedby={`${id}-at-${index}`}
                aria-pressed={picked === index}
                onKeyDown={onKeyDown(index)}
                onClick={() => {
                  // A drag ends in a click too; only a tap (or Enter/Space) picks.
                  const dragged = press.current?.moved ?? false
                  press.current = null
                  if (dragged) return
                  const next = picked === index ? null : index
                  setPicked(next)
                  announce(
                    next === null
                      ? `${NAMES[index] ?? ''} corner put down.`
                      : `${NAMES[index] ?? ''} corner picked. Tap the image where it should go.`,
                  )
                }}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  startPress(event, true)
                  setDragging(index)
                }}
                onPointerMove={(event) => {
                  if (dragging !== index || !pressMoved(event)) return
                  const at = pointAt(event)
                  if (at) setCorners(withCorner(corners, index, at))
                }}
                onPointerUp={(event) => {
                  pressMoved(event)
                  setDragging(null)
                }}
              >
                <span
                  className={cx(
                    'block rounded-full border-2 border-paper shadow',
                    picked === index
                      ? 'size-5 bg-ink outline-2 outline-offset-1 outline-accent'
                      : 'size-4',
                    picked !== index && (dragging === index ? 'bg-ink' : 'bg-accent'),
                  )}
                />
                <span id={`${id}-at-${index}`} className="sr-only">
                  {where(p)}
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {!valid && (
          <p role="alert" className="text-sm text-accent">
            The corners cross over or sit on a line. Move them so they go round the paper in order.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="quiet"
            onClick={() => {
              setCorners(FULL_IMAGE)
            }}
          >
            Whole image
          </Button>
          <div className="ml-auto flex gap-2">
            <Button
              onClick={() => {
                dialog.current?.close()
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() => {
                onApply(isWholeImage(corners) ? null : corners)
                dialog.current?.close()
              }}
            >
              Apply crop
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
