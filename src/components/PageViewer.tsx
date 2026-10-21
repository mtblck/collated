import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import type { Layout } from '../core/geometry'
import type { NumberMark } from '../core/pageNumbers'
import { FIT, clampView, stepFrom, zoomAt, type View } from '../core/zoom'
import { Button, IconButton } from './controls'
import { CloseIcon, MinusIcon, PlusIcon } from './Icons'
import { PagePreview } from './PagePreview'

/**
 * The page, as large as the screen allows, in a modal dialog: pinch or
 * Ctrl+scroll (a trackpad pinch) to zoom about your fingers, drag to move,
 * double-tap to toggle 2×. Buttons and keys do the same (+, −, 0, arrows),
 * so nothing needs a gesture (WCAG 2.5.1). It shows the thumbnail at once,
 * then the full-resolution image when it's ready.
 */
export const PageViewer = ({
  title,
  layout,
  thumbUrl,
  loadDetail,
  mark = null,
  onClose,
}: {
  title: string
  layout: Layout
  thumbUrl: string
  /** Resolves with an object URL for the full-resolution image (revoked on close). */
  loadDetail: () => Promise<string>
  mark?: NumberMark | null
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [view, setView] = useState<View>(FIT)
  const [detail, setDetail] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  /** Pointers down on the stage, and where the gesture started. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ view: View; distance: number; mid: { x: number; y: number } } | null>(
    null,
  )
  const lastTap = useRef(0)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  // Sharp image once it's ready; released when the viewer closes.
  useEffect(() => {
    let url: string | null = null
    let live = true
    loadDetail().then(
      (made) => {
        url = made
        if (live) setDetail(made)
        else URL.revokeObjectURL(made)
      },
      () => {
        /* keep the thumbnail */
      },
    )
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [loadDetail])

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => {
      const box = el.getBoundingClientRect()
      setSize({ width: Math.max(1, box.width), height: Math.max(1, box.height) })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(el)
    return () => {
      observer?.disconnect()
    }
  }, [])

  /** Stage pixels from its centre. */
  const fromCentre = (clientX: number, clientY: number) => {
    const box = stage.current?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 }
  }

  const percent = Math.round(view.scale * 100)
  const setAndSay = (next: View) => {
    setView(next)
    setAnnouncement(`${String(Math.round(next.scale * 100))}%`)
  }
  const step = (direction: 1 | -1) => {
    setAndSay(zoomAt(view, stepFrom(view.scale, direction), { x: 0, y: 0 }, size))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    startGesture()
  }
  const startGesture = () => {
    const points = [...pointers.current.values()]
    const [a, b] = points
    if (!a) {
      gesture.current = null
      return
    }
    const mid = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a
    gesture.current = {
      view,
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0,
      mid: fromCentre(mid.x, mid.y),
    }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const start = gesture.current
    if (!start) return
    const [a, b] = [...pointers.current.values()]
    if (!a) return
    if (b && start.distance > 0) {
      // Pinch: zoom about where the fingers started, and follow them as they move.
      const mid = fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2)
      const scale = (start.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / start.distance
      const zoomed = zoomAt(start.view, scale, start.mid, size)
      setView(
        clampView(
          { ...zoomed, x: zoomed.x + mid.x - start.mid.x, y: zoomed.y + mid.y - start.mid.y },
          size,
        ),
      )
    } else {
      const at = fromCentre(a.x, a.y)
      setView(
        clampView(
          {
            ...start.view,
            x: start.view.x + at.x - start.mid.x,
            y: start.view.y + at.y - start.mid.y,
          },
          size,
        ),
      )
    }
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const wasSingle = pointers.current.size === 1
    pointers.current.delete(event.pointerId)
    // Double-tap toggles between fit and 2× at the tap.
    if (wasSingle && event.pointerType !== 'mouse') {
      const now = performance.now()
      if (now - lastTap.current < 300) {
        setAndSay(
          view.scale > 1 ? FIT : zoomAt(view, 2, fromCentre(event.clientX, event.clientY), size),
        )
        lastTap.current = 0
      } else lastTap.current = now
    }
    startGesture()
  }

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // A trackpad pinch arrives as Ctrl+wheel; without preventDefault the
      // browser zooms the whole page instead.
      event.preventDefault()
      setView(
        zoomAt(
          view,
          view.scale * Math.exp(-event.deltaY * 0.01),
          fromCentre(event.clientX, event.clientY),
          size,
        ),
      )
    } else if (view.scale > 1) {
      event.preventDefault()
      setView(clampView({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }, size))
    }
  }

  const onKeyDown = (event: globalThis.KeyboardEvent) => {
    const pan = 60
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [pan, 0],
      ArrowRight: [-pan, 0],
      ArrowUp: [0, pan],
      ArrowDown: [0, -pan],
    }
    const move = moves[event.key]
    if (event.key === '+' || event.key === '=') step(1)
    else if (event.key === '-' || event.key === '_') step(-1)
    else if (event.key === '0') setAndSay(FIT)
    else if (move && view.scale > 1) {
      setView(clampView({ ...view, x: view.x + move[0], y: view.y + move[1] }, size))
    } else return
    event.preventDefault()
  }

  // Native listeners: the keys work anywhere in the dialog, and double-click
  // is an extra for pointers (the buttons and keys do the same), so neither
  // needs a role of its own.
  const handlers = useRef<{
    onKeyDown: (event: globalThis.KeyboardEvent) => void
    onDoubleClick: (event: MouseEvent) => void
    onWheel: (event: WheelEvent) => void
    onGesture: (event: Event & { scale?: number }, start: boolean) => void
  } | null>(null)
  const gestureStart = useRef<View>(FIT)
  useLayoutEffect(() => {
    handlers.current = {
      onKeyDown,
      onWheel,
      // Safari's trackpad pinch: its own gesture events, with a running scale.
      onGesture: (event, start) => {
        event.preventDefault()
        // On a touch screen Safari sends these alongside the pointer events,
        // which already pinch; only a trackpad needs them.
        if (pointers.current.size >= 2) return
        if (start) gestureStart.current = view
        else
          setView(
            zoomAt(
              gestureStart.current,
              gestureStart.current.scale * (event.scale ?? 1),
              { x: 0, y: 0 },
              size,
            ),
          )
      },
      onDoubleClick: (event: MouseEvent) => {
        setAndSay(
          view.scale > 1 ? FIT : zoomAt(view, 2, fromCentre(event.clientX, event.clientY), size),
        )
      },
    }
  })
  useEffect(() => {
    const d = dialog.current
    const s = stage.current
    const key = (event: globalThis.KeyboardEvent) => {
      handlers.current?.onKeyDown(event)
    }
    const dbl = (event: MouseEvent) => {
      handlers.current?.onDoubleClick(event)
    }
    // Not passive: the viewer, not the browser, zooms on a pinch.
    const wheel = (event: WheelEvent) => {
      handlers.current?.onWheel(event)
    }
    const gestureStartEvent = (event: Event) => {
      handlers.current?.onGesture(event, true)
    }
    const gestureChange = (event: Event) => {
      handlers.current?.onGesture(event, false)
    }
    d?.addEventListener('keydown', key)
    s?.addEventListener('dblclick', dbl)
    s?.addEventListener('wheel', wheel, { passive: false })
    s?.addEventListener('gesturestart', gestureStartEvent)
    s?.addEventListener('gesturechange', gestureChange)
    return () => {
      d?.removeEventListener('keydown', key)
      s?.removeEventListener('dblclick', dbl)
      s?.removeEventListener('wheel', wheel)
      s?.removeEventListener('gesturestart', gestureStartEvent)
      s?.removeEventListener('gesturechange', gestureChange)
    }
  }, [])

  const boxRatio = size.width / size.height

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-paper-sunk p-0 text-ink backdrop:bg-ink/60"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper px-4 py-2 sm:px-6">
          <h2 id={`${id}-title`} className="min-w-0 flex-1 truncate font-display text-2xl">
            {title}
          </h2>
          <p id={`${id}-help`} className="sr-only">
            Pinch, or use the zoom buttons or the plus and minus keys, to zoom. Drag or use the
            arrow keys to move around. Zero fits the page.
          </p>
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <IconButton
              label="Zoom out (−)"
              inactive={view.scale <= 1}
              onClick={() => {
                step(-1)
              }}
            >
              <MinusIcon />
            </IconButton>
            {/* Not an <output>: that's a live region, and a pinch would read out
                every frame. Discrete changes are announced below. */}
            <span
              className="w-14 text-center text-sm tabular-nums"
              aria-hidden="true"
              data-zoom-level
            >
              {percent}%
            </span>
            <IconButton
              label="Zoom in (+)"
              inactive={view.scale >= 8}
              onClick={() => {
                step(1)
              }}
            >
              <PlusIcon />
            </IconButton>
            <Button
              variant="quiet"
              inactive={view.scale === 1}
              onClick={() => {
                setAndSay(FIT)
              }}
            >
              Fit
            </Button>
          </div>
          <IconButton
            label="Close"
            onClick={() => {
              dialog.current?.close()
            }}
          >
            <CloseIcon />
          </IconButton>
        </div>
        {/* Keys work anywhere in the dialog (handled on it), so the stage
            needs no tab stop of its own. */}
        <div
          ref={stage}
          className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="absolute inset-0 p-4 sm:p-8"
            style={{
              transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
            }}
          >
            <PagePreview
              layout={layout}
              thumbUrl={detail ?? thumbUrl}
              boxRatio={boxRatio}
              mark={mark}
            />
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </dialog>
  )
}
