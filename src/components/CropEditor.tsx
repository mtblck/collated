import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { EDGE_NAMES, edgeMidpoint, moveEdge, quadFromView, quadToView } from '../core/cropFrame'
import type { Asset } from '../core/model'
import { FULL_IMAGE, isConvex, isWholeImage, type Point, type Quad } from '../core/perspective'
import { Button } from './controls'
import { cx } from './cx'

const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'] as const
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** A corner, or an edge (which moves the two corners it joins). */
interface Handle {
  kind: 'corner' | 'edge'
  index: number
}
const same = (a: Handle | null, b: Handle) => a?.kind === b.kind && a.index === b.index
const nameOf = ({ kind, index }: Handle) =>
  kind === 'corner' ? `${CORNER_NAMES[index] ?? ''} corner` : `${EDGE_NAMES[index] ?? ''} edge`

const withCorner = (quad: Quad, index: number, point: Point): Quad => {
  const next: [Point, Point, Point, Point] = [...quad]
  next[index] = { x: clamp01(point.x), y: clamp01(point.y) }
  return next
}

/** How far (px) a press can move and still count as a tap, not a drag. */
const TAP_SLOP = 6

/**
 * Drag the corners of the paper in a photo; the page then shows that
 * quadrilateral flattened to a rectangle. A native modal dialog: focus is
 * trapped and restored, Escape cancels.
 *
 * The image is shown as the page shows it, turned by the page's quarter turns,
 * so "top" is the top you see; corners are stored upright (core/cropFrame.ts).
 * Each edge has a handle at its middle that moves its two corners together,
 * straight in or out, for crops with straight sides. A page not yet cropped
 * opens with the corners on the paper found in the photo (`suggested`), if
 * one was; nothing is applied until Apply crop.
 *
 * Three ways to move a handle: drag it; tap it, then tap where it goes (a
 * single-pointer alternative to dragging, WCAG 2.5.7); or focus it and use the
 * arrow keys (Shift for 5% steps). Each handle keeps a stable name; where it
 * is goes in its description, and moves are announced in one polite region,
 * after the keys settle rather than on every press.
 */
export const CropEditor = ({
  asset,
  turns = 0,
  initial,
  suggested = null,
  onApply,
  onClose,
}: {
  asset: Pick<Asset, 'name' | 'thumbUrl' | 'width' | 'height'>
  /** The page's quarter turns, clockwise: the editor shows the image turned. */
  turns?: number
  initial: Quad | null
  /** Where the paper was found, if it was: the start when there's no crop yet. */
  suggested?: Quad | null
  onApply: (corners: Quad | null) => void
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const sideways = ((turns % 4) + 4) % 2 === 1
  // The view's size: the image's, swapped when it's turned on its side.
  const width = sideways ? asset.height : asset.width
  const height = sideways ? asset.width : asset.height
  // Corners as seen, in screen order; converted back to upright on apply.
  const found = initial === null && suggested !== null
  const [corners, setCorners] = useState<Quad>(() =>
    quadToView(initial ?? suggested ?? FULL_IMAGE, turns),
  )
  const [dragging, setDragging] = useState<Handle | null>(null)
  /** The handle a tap on the image will move. */
  const [picked, setPicked] = useState<Handle | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Where the current press started, the corners then, and whether it's a drag. */
  const press = useRef<{
    pointerId: number
    /** Still down: a second finger mustn't take over the drag. */
    down: boolean
    x: number
    y: number
    moved: boolean
    onHandle: boolean
    from: Quad
    at: Point | null
  } | null>(null)
  const valid = isConvex(corners)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      clearTimeout(settle.current)
    }
  }, [])

  const where = (p: Point) => `${percent(p.x)} across, ${percent(p.y)} down`
  const positionOf = (handle: Handle, quad: Quad) =>
    handle.kind === 'corner' ? (quad[handle.index] ?? quad[0]) : edgeMidpoint(quad, handle.index)
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

  /** `handle` moved: a corner to `to`, an edge by `to` minus its start. */
  const moved = (handle: Handle, from: Quad, start: Point, to: Point): Quad =>
    handle.kind === 'corner'
      ? withCorner(from, handle.index, to)
      : moveEdge(from, handle.index, { x: to.x - start.x, y: to.y - start.y }, width, height)

  /** Whether `event` is the pointer pressing now. */
  const ours = (event: PointerEvent) => press.current?.pointerId === event.pointerId
  const startPress = (event: PointerEvent, onHandle: boolean) => {
    if (press.current?.down && !ours(event)) return false
    press.current = {
      pointerId: event.pointerId,
      down: true,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      onHandle,
      from: corners,
      at: pointAt(event),
    }
    return true
  }
  /** A cancelled touch (a system gesture, a palm) lets go without moving anything. */
  const cancelPress = (event: PointerEvent) => {
    if (!ours(event)) return
    press.current = null
    setDragging(null)
  }
  const pressMoved = (event: PointerEvent) => {
    const p = press.current
    if (p && !p.moved && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TAP_SLOP) {
      p.moved = true
    }
    return p?.moved ?? false
  }

  const onKeyDown = (handle: Handle) => (event: KeyboardEvent<HTMLButtonElement>) => {
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
    const start = positionOf(handle, corners)
    const next = moved(handle, corners, start, { x: start.x + delta.x, y: start.y + delta.y })
    if (next === corners && handle.kind === 'edge') {
      // That key runs along the edge, which only moves across.
      const a = corners[handle.index] ?? corners[0]
      const b = corners[(handle.index + 1) % 4] ?? corners[0]
      const flat = Math.abs((b.x - a.x) * width) > Math.abs((b.y - a.y) * height)
      announce(`${nameOf(handle)} moves ${flat ? 'up and down' : 'left and right'} only.`)
      return
    }
    setCorners(next)
    announce(`${nameOf(handle)}, ${where(positionOf(handle, next))}.`, 300)
  }

  const pts = (quad: Quad) => quad.map((p) => `${p.x * width},${p.y * height}`).join(' ')
  const outline = pts(corners)
  const handles: Handle[] = [
    ...[0, 1, 2, 3].map((index) => ({ kind: 'corner' as const, index })),
    ...[0, 1, 2, 3].map((index) => ({ kind: 'edge' as const, index })),
  ]

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={found ? `${id}-found ${id}-help` : `${id}-help`}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
            Crop to the page
          </h2>
          <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
            Drag each corner onto a corner of the paper, or tap a corner and then tap where it goes;
            it will be flattened into a straight rectangle. The handles on the edges move a whole
            side, for a straight crop. With a keyboard, focus a handle and use the arrow keys (hold
            Shift for bigger steps).
          </p>
          {found && (
            <p id={`${id}-found`} className="mt-2 text-sm font-medium text-ink">
              The corners are on the paper found in the photo. Check them, then apply.
            </p>
          )}
        </div>

        <div className="flex justify-center bg-paper-sunk p-4 sm:p-6">
          <div
            ref={stage}
            className={cx('relative touch-none select-none', picked !== null && 'cursor-crosshair')}
            style={{
              aspectRatio: `${width} / ${height}`,
              width: `min(100%, calc(60dvh * ${width / height}))`,
            }}
            onPointerDown={(event) => {
              if (!(event.target instanceof Element && event.target.closest('button'))) {
                // A second finger on the image doesn't interrupt a drag.
                startPress(event, false)
              }
            }}
            onPointerCancel={cancelPress}
            onPointerMove={(event) => {
              const p = press.current
              if (!ours(event) || !pressMoved(event) || dragging === null || !p?.at) return
              const at = pointAt(event)
              if (at) setCorners(moved(dragging, p.from, p.at, at))
            }}
            onPointerUp={(event) => {
              if (!ours(event)) return
              const onImage = press.current !== null && !press.current.onHandle
              const tap = onImage && !pressMoved(event)
              // A press on a handle is left for its click to read.
              if (onImage) press.current = null
              setDragging(null)
              // Tap-to-place: the picked handle goes where the image was tapped.
              if (!tap || picked === null) return
              const at = pointAt(event)
              if (!at) return
              const next = moved(picked, corners, positionOf(picked, corners), at)
              setCorners(next)
              setPicked(null)
              announce(`${nameOf(picked)} moved to ${where(positionOf(picked, next))}.`)
            }}
          >
            {/* The upright image, turned as the page turns it: sideways, it
                spans the view's height, so its box is the view's swapped. */}
            <img
              src={asset.thumbUrl}
              alt={`The whole of ${asset.name}${turns % 4 ? ', turned as on the page' : ''}`}
              className="absolute top-1/2 left-1/2 block max-w-none"
              style={{
                width: sideways ? `${(100 * asset.width) / asset.height}%` : '100%',
                height: sideways ? `${(100 * asset.height) / asset.width}%` : '100%',
                transform: `translate(-50%, -50%) rotate(${String(turns * 90)}deg)`,
              }}
              draggable={false}
            />
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {/* Dim everything outside the crop. */}
              <path
                d={`M0 0H${width}V${height}H0Z M${outline.replaceAll(' ', ' L')}Z`}
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
            {handles.map((handle) => {
              const at = positionOf(handle, corners)
              const key = `${handle.kind}-${String(handle.index)}`
              const isPicked = same(picked, handle)
              // An edge's bar lies along the edge as drawn.
              const a = corners[handle.index] ?? corners[0]
              const b = corners[(handle.index + 1) % 4] ?? corners[0]
              const angle = (Math.atan2((b.y - a.y) * height, (b.x - a.x) * width) * 180) / Math.PI
              return (
                <button
                  key={key}
                  type="button"
                  className={cx(
                    'absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full',
                    handle.kind === 'corner' ? 'cursor-grab active:cursor-grabbing' : 'cursor-move',
                    'focus-visible:outline-offset-0',
                  )}
                  style={{ left: percent(at.x), top: percent(at.y) }}
                  aria-label={nameOf(handle)}
                  aria-describedby={`${id}-${key}`}
                  aria-pressed={isPicked}
                  onKeyDown={onKeyDown(handle)}
                  onClick={() => {
                    // A drag ends in a click too; only a tap (or Enter/Space) picks.
                    const dragged = press.current?.moved ?? false
                    press.current = null
                    if (dragged) return
                    const next = isPicked ? null : handle
                    setPicked(next)
                    announce(
                      next === null
                        ? `${nameOf(handle)} put down.`
                        : `${nameOf(handle)} picked. Tap the image where it should go.`,
                    )
                  }}
                  onPointerDown={(event) => {
                    if (!startPress(event, true)) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setDragging(handle)
                  }}
                  onPointerCancel={cancelPress}
                  onPointerMove={(event) => {
                    const p = press.current
                    if (!ours(event) || !same(dragging, handle) || !pressMoved(event) || !p?.at)
                      return
                    const to = pointAt(event)
                    if (to) setCorners(moved(handle, p.from, p.at, to))
                  }}
                  onPointerUp={(event) => {
                    if (!ours(event)) return
                    pressMoved(event)
                    // Kept (not down) for this press's click to read.
                    if (press.current) press.current.down = false
                    setDragging(null)
                  }}
                >
                  <span
                    className={cx(
                      'block border-2 border-paper shadow',
                      handle.kind === 'corner' ? 'rounded-full' : 'rounded-[2px]',
                      handle.kind === 'corner'
                        ? isPicked
                          ? 'size-5'
                          : 'size-4'
                        : isPicked
                          ? 'h-2.5 w-7'
                          : 'h-2 w-6',
                      isPicked && 'bg-ink outline-2 outline-offset-1 outline-accent',
                      !isPicked && (same(dragging, handle) ? 'bg-ink' : 'bg-accent'),
                    )}
                    style={
                      handle.kind === 'edge' ? { transform: `rotate(${String(angle)}deg)` } : {}
                    }
                  />
                  <span id={`${id}-${key}`} className="sr-only">
                    {handle.kind === 'edge'
                      ? `Moves the ${(CORNER_NAMES[handle.index] ?? '').toLowerCase()} and ${(CORNER_NAMES[(handle.index + 1) % 4] ?? '').toLowerCase()} corners together. `
                      : ''}
                    {where(at)}
                  </span>
                </button>
              )
            })}
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
                const upright = quadFromView(corners, turns)
                onApply(isWholeImage(corners) ? null : upright)
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
