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

/**
 * Drag the four corners of the paper in a photo; the page then shows that
 * quadrilateral flattened to a rectangle. A native modal dialog: focus is
 * trapped and restored, Escape cancels. Each corner is a button that moves
 * with the arrow keys (Shift for 5% steps), so it works without a pointer.
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
  const valid = isConvex(corners)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  const pointAt = (event: PointerEvent): Point | null => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return null
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
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
    setCorners(withCorner(corners, index, { x: p.x + delta.x, y: p.y + delta.y }))
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
            Drag each corner onto a corner of the paper; it will be flattened into a straight
            rectangle. Or select a corner and use the arrow keys (hold Shift for bigger steps).
          </p>
        </div>

        <div className="flex justify-center bg-paper-sunk p-4 sm:p-6">
          <div
            ref={stage}
            className="relative touch-none select-none"
            style={{
              aspectRatio: `${asset.width} / ${asset.height}`,
              width: `min(100%, calc(60dvh * ${asset.width / asset.height}))`,
            }}
            onPointerMove={(event) => {
              if (dragging === null) return
              const p = pointAt(event)
              if (p) setCorners(withCorner(corners, dragging, p))
            }}
            onPointerUp={() => {
              setDragging(null)
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
              <polygon
                points={outline}
                fill="none"
                stroke={valid ? 'var(--c-accent)' : '#c00'}
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
                aria-label={`${NAMES[index] ?? ''} corner, ${percent(p.x)} across, ${percent(p.y)} down`}
                onKeyDown={onKeyDown(index)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setDragging(index)
                }}
                onPointerMove={(event) => {
                  if (dragging !== index) return
                  const at = pointAt(event)
                  if (at) setCorners(withCorner(corners, index, at))
                }}
                onPointerUp={() => {
                  setDragging(null)
                }}
              >
                <span
                  className={cx(
                    'block size-4 rounded-full border-2 border-paper shadow',
                    dragging === index ? 'bg-ink' : 'bg-accent',
                  )}
                />
              </button>
            ))}
          </div>
        </div>

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
