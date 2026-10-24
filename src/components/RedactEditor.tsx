import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { fromView, toView } from '../core/cropFrame'
import type { Asset, Redaction } from '../core/model'
import { MIN_SIDE, cleanRedactions } from '../core/redact'
import type { Point } from '../core/perspective'
import { Button } from './controls'
import { cx } from './cx'

const percent = (n: number) => `${Math.round(n * 1000) / 10}%`
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** How far (px) a press can move and still count as a tap, not a drag. */
const TAP_SLOP = 6
/** A new box from Add a box: a line of text, about. */
const NEW_BOX = { width: 0.4, height: 0.08 }

/** A box's body moves it; its corner handle sizes it. */
interface Handle {
  kind: 'move' | 'size'
  index: number
}
const same = (a: Handle | null, b: Handle) => a?.kind === b.kind && a.index === b.index
const nameOf = ({ kind, index }: Handle) =>
  kind === 'move' ? `Box ${String(index + 1)}` : `Box ${String(index + 1)} size`

/** A stored box (upright image) as seen turned, and back. */
const boxToView = (box: Redaction, turns: number): Redaction => {
  const a = toView({ x: box.x0, y: box.y0 }, turns)
  const b = toView({ x: box.x1, y: box.y1 }, turns)
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  }
}
const boxFromView = (box: Redaction, turns: number): Redaction => {
  const a = fromView({ x: box.x0, y: box.y0 }, turns)
  const b = fromView({ x: box.x1, y: box.y1 }, turns)
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  }
}

/** `box` moved by `delta`, kept whole inside the image. */
const shifted = (box: Redaction, delta: Point): Redaction => {
  const w = box.x1 - box.x0
  const h = box.y1 - box.y0
  const x0 = Math.min(1 - w, Math.max(0, box.x0 + delta.x))
  const y0 = Math.min(1 - h, Math.max(0, box.y0 + delta.y))
  return { x0, y0, x1: x0 + w, y1: y0 + h }
}

/** `box` with its bottom-right corner at `to`, never smaller than a sliver. */
const sized = (box: Redaction, to: Point): Redaction => ({
  ...box,
  x1: Math.max(box.x0 + MIN_SIDE * 2, clamp01(to.x)),
  y1: Math.max(box.y0 + MIN_SIDE * 2, clamp01(to.y)),
})

const between = (a: Point, b: Point): Redaction => ({
  x0: clamp01(Math.min(a.x, b.x)),
  y0: clamp01(Math.min(a.y, b.y)),
  x1: clamp01(Math.max(a.x, b.x)),
  y1: clamp01(Math.max(a.y, b.y)),
})

/**
 * Draw boxes over what a page must not show (#77): an account number, an ID
 * number. The export removes what's under them rather than covering it (see
 * core/redact.ts). A native modal dialog like the crop editor: focus is
 * trapped and restored, Escape cancels, nothing changes until Apply.
 *
 * The whole image is shown, turned as the page turns it, whatever the crop:
 * boxes are stored on the upright image so a later crop can't move them off
 * what they cover. Three ways to make and move boxes: drag on the image (or
 * drag a box, or its corner); Add a box, then tap a box or corner and tap
 * where it goes (WCAG 2.5.7); or focus a box or its corner and use the arrow
 * keys (Shift for 5% steps), Delete to remove it.
 */
export const RedactEditor = ({
  asset,
  turns = 0,
  initial,
  loadDetail,
  onApply,
  onClose,
}: {
  asset: Pick<Asset, 'name' | 'thumbUrl' | 'width' | 'height'>
  /** The page's quarter turns, clockwise: the editor shows the image turned. */
  turns?: number
  initial: readonly Redaction[]
  /** Resolves with an object URL of the whole image, sharper than the thumbnail (revoked on close). */
  loadDetail?: () => Promise<string>
  onApply: (boxes: Redaction[]) => void
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const handleRefs = useRef(new Map<string, HTMLButtonElement>())
  const sideways = ((turns % 4) + 4) % 2 === 1
  const width = sideways ? asset.height : asset.width
  const height = sideways ? asset.width : asset.height
  const [boxes, setBoxes] = useState<Redaction[]>(() => initial.map((b) => boxToView(b, turns)))
  const [selected, setSelected] = useState<number | null>(null)
  /** The handle a tap on the image will move. */
  const [picked, setPicked] = useState<Handle | null>(null)
  /** A box being drawn by dragging on the image. */
  const [drawing, setDrawing] = useState<Redaction | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [detail, setDetail] = useState<string | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Focus this handle after the next render (a box was added or removed). */
  const focusNext = useRef<string | null>(null)
  const press = useRef<{
    pointerId: number
    down: boolean
    x: number
    y: number
    moved: boolean
    /** The handle pressed, or null for the image itself. */
    handle: Handle | null
    from: Redaction[]
    at: Point | null
  } | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      clearTimeout(settle.current)
    }
  }, [])

  useEffect(() => {
    if (!loadDetail) return
    let url: string | null = null
    let current = true
    loadDetail().then(
      (made) => {
        url = made
        if (current) setDetail(made)
        else URL.revokeObjectURL(made)
      },
      () => {
        /* the thumbnail will do */
      },
    )
    return () => {
      current = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [loadDetail])

  useEffect(() => {
    const key = focusNext.current
    focusNext.current = null
    if (key === 'add') addButton.current?.focus()
    else if (key) handleRefs.current.get(key)?.focus()
  })

  const announce = (text: string, delay = 0) => {
    clearTimeout(settle.current)
    if (delay === 0) setAnnouncement(text)
    else
      settle.current = setTimeout(() => {
        setAnnouncement(text)
      }, delay)
  }
  const where = (box: Redaction) =>
    `${percent(box.x0)} across, ${percent(box.y0)} down, ${percent(box.x1 - box.x0)} wide, ${percent(box.y1 - box.y0)} high`

  const pointAt = (event: PointerEvent): Point | null => {
    const rect = stage.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  const replace = (index: number, box: Redaction) => {
    setBoxes((all) => all.map((b, i) => (i === index ? box : b)))
  }
  /** `handle` dragged from `start` to `to`, from the boxes as they were. */
  const dragged = (from: Redaction[], handle: Handle, start: Point, to: Point) => {
    const box = from[handle.index]
    if (!box) return from
    const next =
      handle.kind === 'move'
        ? shifted(box, { x: to.x - start.x, y: to.y - start.y })
        : sized(box, { x: box.x1 + to.x - start.x, y: box.y1 + to.y - start.y })
    return from.map((b, i) => (i === handle.index ? next : b))
  }

  const remove = (index: number) => {
    const next = boxes.filter((_, i) => i !== index)
    setBoxes(next)
    setPicked(null)
    setSelected(next.length ? Math.min(index, next.length - 1) : null)
    focusNext.current = next.length ? `move-${String(Math.min(index, next.length - 1))}` : 'add'
    announce(`Box ${String(index + 1)} removed. ${plural(next.length)}.`)
  }

  const add = () => {
    const box: Redaction = {
      x0: (1 - NEW_BOX.width) / 2,
      y0: (1 - NEW_BOX.height) / 2,
      x1: (1 + NEW_BOX.width) / 2,
      y1: (1 + NEW_BOX.height) / 2,
    }
    const index = boxes.length
    setBoxes([...boxes, box])
    setSelected(index)
    focusNext.current = `move-${String(index)}`
    announce(`Box ${String(index + 1)} added in the middle. Move it with the arrow keys.`)
  }

  const ours = (event: PointerEvent) => press.current?.pointerId === event.pointerId
  const startPress = (event: PointerEvent, handle: Handle | null) => {
    if (press.current?.down && !ours(event)) return false
    press.current = {
      pointerId: event.pointerId,
      down: true,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      handle,
      from: boxes,
      at: pointAt(event),
    }
    return true
  }
  const cancelPress = (event: PointerEvent) => {
    if (!ours(event)) return
    press.current = null
    setDrawing(null)
  }
  const pressMoved = (event: PointerEvent) => {
    const p = press.current
    if (p && !p.moved && Math.hypot(event.clientX - p.x, event.clientY - p.y) > TAP_SLOP) {
      p.moved = true
    }
    return p?.moved ?? false
  }

  const onKeyDown = (handle: Handle) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(handle.index)
      return
    }
    const step = event.shiftKey ? 0.05 : 0.005
    const move: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }
    const delta = move[event.key]
    const box = boxes[handle.index]
    if (!delta || !box) return
    event.preventDefault()
    const next =
      handle.kind === 'move'
        ? shifted(box, delta)
        : sized(box, { x: box.x1 + delta.x, y: box.y1 + delta.y })
    replace(handle.index, next)
    setSelected(handle.index)
    announce(`${nameOf({ kind: 'move', index: handle.index })}, ${where(next)}.`, 300)
  }

  const handleKey = (h: Handle) => `${h.kind}-${String(h.index)}`
  const handleProps = (handle: Handle) => ({
    ref: (el: HTMLButtonElement | null) => {
      if (el) handleRefs.current.set(handleKey(handle), el)
      else handleRefs.current.delete(handleKey(handle))
    },
    type: 'button' as const,
    'aria-label': nameOf(handle),
    'aria-describedby': `${id}-${handleKey(handle)}`,
    'aria-pressed': same(picked, handle),
    onKeyDown: onKeyDown(handle),
    onFocus: () => {
      setSelected(handle.index)
    },
    onClick: () => {
      // A drag ends in a click too; only a tap (or Enter/Space) picks.
      const wasDrag = press.current?.moved ?? false
      press.current = null
      if (wasDrag) return
      const next = same(picked, handle) ? null : handle
      setPicked(next)
      setSelected(handle.index)
      announce(
        next === null
          ? `${nameOf(handle)} put down.`
          : `${nameOf(handle)} picked. Tap the image where ${handle.kind === 'move' ? 'its middle' : 'its bottom-right corner'} should go.`,
      )
    },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!startPress(event, handle)) return
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerCancel: cancelPress,
    onPointerMove: (event: PointerEvent) => {
      const p = press.current
      if (!ours(event) || !p?.handle || !same(p.handle, handle) || !pressMoved(event) || !p.at) {
        return
      }
      const to = pointAt(event)
      if (to) setBoxes(dragged(p.from, handle, p.at, to))
    },
    onPointerUp: (event: PointerEvent) => {
      if (!ours(event)) return
      pressMoved(event)
      // Kept (not down) for this press's click to read.
      if (press.current) press.current.down = false
    },
  })

  const shown = drawing ? [...boxes, drawing] : boxes

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl bg-paper p-0 text-ink shadow-panel backdrop:bg-black/50"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
            Black out
          </h2>
          <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
            Drag over anything the PDF must not show, like an account or ID number. What’s under a
            box is removed from the file, not just covered. Drag a box to move it, or its corner to
            size it; or tap a box and then tap where it goes. With a keyboard, use Add a box, then
            the arrow keys on a box or its corner (hold Shift for bigger steps); Delete removes it.
          </p>
        </div>

        <div className="flex justify-center bg-paper-sunk p-4 sm:p-6">
          <div
            ref={stage}
            className="relative cursor-crosshair touch-none select-none"
            style={{
              aspectRatio: `${width} / ${height}`,
              width: `min(100%, calc(60dvh * ${width / height}))`,
            }}
            onPointerDown={(event) => {
              if (event.target instanceof Element && event.target.closest('button')) return
              if (!startPress(event, null)) return
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerCancel={cancelPress}
            onPointerMove={(event) => {
              const p = press.current
              if (!ours(event) || p?.handle !== null || !pressMoved(event) || !p.at) return
              const at = pointAt(event)
              if (at) setDrawing(between(p.at, at))
            }}
            onPointerUp={(event) => {
              const p = press.current
              if (!ours(event) || p?.handle !== null) return
              const moved = pressMoved(event)
              press.current = null
              const at = pointAt(event)
              setDrawing(null)
              if (!at || !p.at) return
              if (moved) {
                const [box] = cleanRedactions([between(p.at, at)])
                if (!box) return
                const index = boxes.length
                setBoxes([...boxes, box])
                setSelected(index)
                setPicked(null)
                announce(`Box ${String(index + 1)} drawn. ${plural(index + 1)}.`)
                return
              }
              // Tap-to-place: the picked handle goes where the image was tapped.
              const box = picked ? boxes[picked.index] : undefined
              if (!picked || !box) return
              const next =
                picked.kind === 'move'
                  ? shifted(box, {
                      x: at.x - (box.x0 + box.x1) / 2,
                      y: at.y - (box.y0 + box.y1) / 2,
                    })
                  : sized(box, at)
              replace(picked.index, next)
              setPicked(null)
              announce(`${nameOf({ kind: 'move', index: picked.index })} moved, ${where(next)}.`)
            }}
          >
            <img
              src={detail ?? asset.thumbUrl}
              alt={`The whole of ${asset.name}${turns % 4 ? ', turned as on the page' : ''}`}
              className="absolute top-1/2 left-1/2 block max-w-none"
              style={{
                width: sideways ? `${(100 * asset.width) / asset.height}%` : '100%',
                height: sideways ? `${(100 * asset.height) / asset.width}%` : '100%',
                transform: `translate(-50%, -50%) rotate(${String(turns * 90)}deg)`,
              }}
              draggable={false}
            />
            {shown.map((box, index) => {
              const live = index < boxes.length
              const move: Handle = { kind: 'move', index }
              const size: Handle = { kind: 'size', index }
              const isSelected = live && selected === index
              const style = {
                left: percent(box.x0),
                top: percent(box.y0),
                width: percent(box.x1 - box.x0),
                height: percent(box.y1 - box.y0),
              }
              if (!live) {
                return (
                  <div
                    key="drawing"
                    aria-hidden="true"
                    className="pointer-events-none absolute bg-black/80 outline-2 outline-accent"
                    style={style}
                  />
                )
              }
              return (
                <div key={index}>
                  <button
                    {...handleProps(move)}
                    className={cx(
                      'absolute cursor-move bg-black focus-visible:outline-offset-2',
                      // Two-tone, so a box shows on dark and light alike (WCAG 1.4.11).
                      'shadow-[0_0_0_1px_rgb(255_255_255/0.9)]',
                      (isSelected || same(picked, move)) &&
                        'outline-2 outline-offset-2 outline-accent',
                    )}
                    style={style}
                  />
                  <button
                    {...handleProps(size)}
                    className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize items-center justify-center rounded-full focus-visible:outline-offset-0"
                    style={{ left: percent(box.x1), top: percent(box.y1) }}
                  >
                    <span
                      className={cx(
                        'block size-4 rounded-[3px] border-2 border-paper shadow',
                        same(picked, size)
                          ? 'size-5 bg-ink outline-2 outline-offset-1 outline-accent'
                          : 'bg-accent',
                      )}
                    />
                  </button>
                  <span id={`${id}-move-${String(index)}`} className="sr-only">
                    {where(box)}
                  </span>
                  <span id={`${id}-size-${String(index)}`} className="sr-only">
                    Bottom-right corner of box {index + 1}. {where(box)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button ref={addButton} onClick={add}>
            Add a box
          </Button>
          <Button
            variant="quiet"
            disabled={selected === null || !boxes[selected]}
            onClick={() => {
              if (selected !== null) remove(selected)
            }}
          >
            Remove box
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
              onClick={() => {
                onApply(cleanRedactions(boxes.map((b) => boxFromView(b, turns))))
                dialog.current?.close()
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  )
}

const plural = (n: number) => `${n === 0 ? 'No' : String(n)} box${n === 1 ? '' : 'es'}`
