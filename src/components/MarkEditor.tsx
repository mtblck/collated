import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SheetLayout } from '../core/geometry'
import {
  MARK_ANGLE_LIMIT,
  MARK_MAX_WIDTH,
  MARK_MIN_WIDTH,
  cleanMark,
  markBox,
  newSignature,
  placedMarks,
} from '../core/marks'
import type { Asset, Mark } from '../core/model'
import type { NumberMark } from '../core/pageNumbers'
import type { Quad } from '../core/perspective'
import type { WatermarkMark } from '../core/watermark'
import { assetStore } from '../import/assetStore'
import type { SavedSignature, SignatureStore } from '../state/signatureStore'
import { Button, IconButton } from './controls'
import { MinusIcon, PlusIcon, RotateLeftIcon, RotateRightIcon, SignIcon, TrashIcon } from './Icons'
import { PagePreview } from './PagePreview'
import { SignatureMaker } from './SignatureMaker'
import { cx } from './cx'

/** How far (px) a press can move and still count as a tap. */
const TAP_SLOP = 8
/** Keyboard and button steps: a nudge, and with Shift a stride. */
const MOVE_STEP = 0.005
const MOVE_STRIDE = 0.05
const SIZE_STEP = 1.1
const TURN_STEP = 1
const TURN_STRIDE = 5

/** Made this page load, so placing one again reuses its bytes and preview URL. */
const made = new Map<string, Asset>()

/** A saved signature as a picture the document holds, its bytes kept like an imported image's. */
const signatureAsset = (signature: SavedSignature): Asset => {
  const id = `signature-${signature.id}`
  const known = made.get(id)
  // Start over empties the asset store (revoking its URLs): make it again then.
  if (known && assetStore.has(id) && assetStore.thumbBlob(known.thumbUrl)) return known
  assetStore.putBytes(id, signature.png)
  const asset: Asset = {
    id,
    name: 'Signature',
    width: signature.width,
    height: signature.height,
    format: 'png',
    bytesId: id,
    storedTurns: 0,
    thumbUrl: assetStore.thumbUrl(
      new Blob([signature.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }),
    ),
    byteLength: signature.png.byteLength,
  }
  made.set(id, asset)
  return asset
}

type Gesture =
  | { kind: 'move' | 'size' | 'turn'; id: string; from: Mark; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; id: string; from: Mark; distance: number; angle: number }
  | { kind: 'tap'; x: number; y: number; moved: boolean }

const percent = (n: number) => `${String(Math.round(n * 1000) / 10)}%`

/**
 * Puts signatures on a page (#111), and in time text and stamps (#112):
 * the page as it will print, with each mark drawn where the export puts it.
 * A native modal dialog that fills a phone's screen; nothing changes until
 * Apply, so the whole visit is one undo step.
 *
 * Every gesture has a one-finger or keyboard way too (WCAG 2.5.1, 2.5.7):
 * drag a signature to move it, its corner to size it, the knob above it to
 * turn it, or pinch with two fingers to do both; or tap the page to move the
 * selected one there, and use Smaller, Larger and the turn buttons; or the
 * arrow keys, + and −, [ and ] (Shift for bigger steps), Delete to remove.
 */
export const MarkEditor = ({
  title,
  sheet,
  thumbUrls,
  covers,
  watermark = null,
  numbers = null,
  initial,
  assets,
  store,
  onApply,
  onClose,
}: {
  title: string
  sheet: SheetLayout
  thumbUrls: readonly string[]
  covers?: readonly (readonly Quad[])[]
  watermark?: WatermarkMark | null
  numbers?: NumberMark | null
  initial: readonly Mark[]
  /** The document's assets: the pictures existing marks show. */
  assets: Readonly<Record<string, Asset>>
  store: SignatureStore
  /** The page's marks, and pictures they show that the document doesn't hold yet. */
  onApply: (marks: Mark[], added: Asset[]) => void
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const markRefs = useRef(new Map<string, HTMLButtonElement>())
  const [marks, setMarks] = useState<Mark[]>(() => [...initial])
  const [added, setAdded] = useState<Record<string, Asset>>({})
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null)
  // With nothing on the page yet, start by making or picking a signature.
  const [making, setMaking] = useState(initial.length === 0)
  const [announcement, setAnnouncement] = useState('')
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const focusNext = useRef<string | null>(null)
  /** The signature just placed from the maker, focused once it closes. */
  const placed = useRef<string | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const all = { ...assets, ...added }
  const { page } = sheet

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => {
      clearTimeout(settle.current)
    }
  }, [])

  useEffect(() => {
    const key = focusNext.current
    focusNext.current = null
    if (key === 'add') addButton.current?.focus()
    else if (key) markRefs.current.get(key)?.focus()
  })

  const announce = (text: string, delay = 0) => {
    clearTimeout(settle.current)
    if (delay === 0) setAnnouncement(text)
    else
      settle.current = setTimeout(() => {
        setAnnouncement(text)
      }, delay)
  }

  const nameOf = (markId: string) =>
    `Signature ${String(marks.findIndex((m) => m.id === markId) + 1)}`
  const where = (mark: Mark) =>
    `${percent(mark.x)} across, ${percent(mark.y)} down, ${percent(mark.width)} of the page wide${mark.angle ? `, turned ${String(Math.round(mark.angle))}°` : ''}`

  const update = (markId: string, fn: (mark: Mark) => Mark, say = true) => {
    const mark = marks.find((m) => m.id === markId)
    if (!mark) return
    const next = cleanMark(fn(mark))
    setMarks((list) => list.map((m) => (m.id === markId ? next : m)))
    if (say) announce(`${nameOf(markId)}, ${where(next)}.`, 300)
  }

  const remove = (markId: string) => {
    const index = marks.findIndex((m) => m.id === markId)
    const rest = marks.filter((m) => m.id !== markId)
    setMarks(rest)
    const next = rest[Math.min(index, rest.length - 1)]
    setSelected(next?.id ?? null)
    focusNext.current = next?.id ?? 'add'
    announce(
      `Signature removed. ${rest.length ? `${String(rest.length)} left` : 'None on the page'}.`,
    )
  }

  const place = (signature: SavedSignature) => {
    const asset = all[`signature-${signature.id}`] ?? signatureAsset(signature)
    if (!(asset.id in assets)) setAdded((list) => ({ ...list, [asset.id]: asset }))
    // A second one goes a little lower than the first, not on top of it.
    const y = Math.min(0.92, 0.75 + marks.length * 0.06)
    const mark = newSignature(crypto.randomUUID(), asset.id, page, { x: 0.5, y })
    setMarks((list) => [...list, mark])
    setSelected(mark.id)
    placed.current = mark.id
    announce(
      'Signature added low on the page. Drag it into place, or tap where it goes; arrow keys move it.',
    )
  }

  /** A point of the page under the pointer, as fractions; and the overlay's box. */
  const frame = () => overlay.current?.getBoundingClientRect() ?? null
  const centreOf = (mark: Mark, rect: DOMRect) => ({
    x: rect.left + mark.x * rect.width,
    y: rect.top + mark.y * rect.height,
  })
  const twoFingers = () => {
    const [a, b] = [...pointers.current.values()]
    if (!a || !b) return null
    return {
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    }
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    event.currentTarget.setPointerCapture(event.pointerId)
    const target = event.target instanceof Element ? event.target.closest('[data-handle]') : null
    const markId = target?.getAttribute('data-mark-id') ?? null
    const handle = target?.getAttribute('data-handle') as 'move' | 'size' | 'turn' | null
    if (pointers.current.size === 2) {
      // A second finger: pinch the selected signature (or the one being dragged).
      const pinched = gesture.current && 'id' in gesture.current ? gesture.current.id : selected
      const from = marks.find((m) => m.id === pinched)
      const fingers = twoFingers()
      gesture.current = from && fingers ? { kind: 'pinch', id: from.id, from, ...fingers } : null
      return
    }
    if (pointers.current.size > 2) return
    const from = markId ? marks.find((m) => m.id === markId) : undefined
    if (from && handle) {
      setSelected(from.id)
      gesture.current = {
        kind: handle,
        id: from.id,
        from,
        x: event.clientX,
        y: event.clientY,
        moved: false,
      }
    } else {
      gesture.current = { kind: 'tap', x: event.clientX, y: event.clientY, moved: false }
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const g = gesture.current
    const rect = frame()
    if (!g || !rect || rect.width === 0) return
    if (g.kind === 'pinch') {
      const fingers = twoFingers()
      if (!fingers || g.distance === 0) return
      update(
        g.id,
        () => ({
          ...g.from,
          width: g.from.width * (fingers.distance / g.distance),
          angle: g.from.angle + fingers.angle - g.angle,
        }),
        false,
      )
      return
    }
    if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) > TAP_SLOP) g.moved = true
    if (!g.moved || g.kind === 'tap') return
    const { from } = g
    if (g.kind === 'move') {
      update(
        g.id,
        () => ({
          ...from,
          x: from.x + (event.clientX - g.x) / rect.width,
          y: from.y + (event.clientY - g.y) / rect.height,
        }),
        false,
      )
      return
    }
    const c = centreOf(from, rect)
    if (g.kind === 'size') {
      const start = Math.hypot(g.x - c.x, g.y - c.y)
      const now = Math.hypot(event.clientX - c.x, event.clientY - c.y)
      if (start > 0) update(g.id, () => ({ ...from, width: (from.width * now) / start }), false)
      return
    }
    const turned =
      (Math.atan2(event.clientY - c.y, event.clientX - c.x) - Math.atan2(g.y - c.y, g.x - c.x)) *
      (180 / Math.PI)
    // Past ±180° the difference wraps; keep the short way round.
    const delta = ((((turned + 180) % 360) + 360) % 360) - 180
    update(g.id, () => ({ ...from, angle: from.angle + delta }), false)
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return
    const g = gesture.current
    if (event.type === 'pointercancel') {
      gesture.current = null
      return
    }
    if (g?.kind === 'pinch') {
      // Lifting one finger ends the pinch; the other doesn't start a drag.
      gesture.current = null
      const mark = marks.find((m) => m.id === g.id)
      if (mark) announce(`${nameOf(g.id)}, ${where(mark)}.`)
      return
    }
    gesture.current = null
    if (!g) return
    if (g.kind !== 'tap') {
      const mark = marks.find((m) => m.id === g.id)
      if (g.moved && mark) announce(`${nameOf(g.id)}, ${where(mark)}.`)
      return
    }
    // A tap on the page puts the selected signature there.
    const rect = frame()
    const mark = marks.find((m) => m.id === selected)
    if (g.moved || !rect || !mark) return
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    update(mark.id, (m) => ({ ...m, x, y }), false)
    announce(`${nameOf(mark.id)} moved, ${where(cleanMark({ ...mark, x, y }))}.`)
  }

  const resize = (markId: string, factor: number) => {
    update(markId, (m) => ({ ...m, width: m.width * factor }))
  }
  const turn = (markId: string, by: number) => {
    update(markId, (m) => ({ ...m, angle: m.angle + by }))
  }

  const onKeyDown = (markId: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const stride = event.shiftKey
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      const step = stride ? MOVE_STRIDE : MOVE_STEP
      update(markId, (m) => ({ ...m, x: m.x + move[0] * step, y: m.y + move[1] * step }))
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      resize(markId, stride ? SIZE_STEP ** 3 : SIZE_STEP)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      resize(markId, stride ? SIZE_STEP ** -3 : 1 / SIZE_STEP)
    } else if (event.key === '[' || event.key === '{') {
      event.preventDefault()
      turn(markId, -(stride ? TURN_STRIDE : TURN_STEP))
    } else if (event.key === ']' || event.key === '}') {
      event.preventDefault()
      turn(markId, stride ? TURN_STRIDE : TURN_STEP)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove(markId)
    }
  }

  const current = marks.find((m) => m.id === selected)
  const pictureOf = (mark: Mark) => all[mark.assetId]
  const atMin = (mark: Mark) => mark.width <= MARK_MIN_WIDTH + 1e-9
  const atMax = (mark: Mark) => mark.width >= MARK_MAX_WIDTH - 1e-9

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className={cx(
        'm-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-paper p-0 text-ink backdrop:bg-black/50',
        'sm:m-auto sm:h-[calc(100dvh-2rem)] sm:w-[min(60rem,calc(100vw-2rem))] sm:rounded-2xl sm:shadow-panel',
      )}
      onClose={(event) => {
        // React passes the signature maker's close up to here; only ours counts.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-full flex-col gap-3 p-4 sm:gap-4 sm:p-6">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
            {title}
          </h2>
          <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
            Drag a signature into place, or tap the page where it goes. Pinch, or drag its corner,
            to size it; drag the knob above it to turn it. Keys: arrows move, + and − size, [ and ]
            turn, Delete removes.
          </p>
        </div>

        <div className="relative min-h-0 flex-1 rounded-xl bg-paper-sunk p-3 sm:p-5">
          <PagePreview
            sheet={sheet}
            thumbUrls={thumbUrls}
            {...(covers ? { covers } : {})}
            marks={placedMarks({ marks }, page, all)}
            mark={numbers}
            watermark={watermark}
          >
            <div
              ref={overlay}
              data-mark-stage
              className="absolute inset-0 touch-none select-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
            >
              {/* The signatures themselves are drawn by the preview, under the
                  watermark and page number as printed; these are their handles. */}
              {marks.map((mark, index) => {
                const picture = pictureOf(mark)
                if (!picture) return null
                const box = markBox(mark, page, picture)
                const isSelected = mark.id === selected
                return (
                  <div
                    key={mark.id}
                    className="absolute"
                    style={{
                      left: percent(box.cx / page.width),
                      top: percent(box.cy / page.height),
                      width: percent(box.width / page.width),
                      height: percent(box.height / page.height),
                      transform: `translate(-50%, -50%) rotate(${String(box.rotation)}deg)`,
                    }}
                  >
                    <button
                      ref={(el) => {
                        if (el) markRefs.current.set(mark.id, el)
                        else markRefs.current.delete(mark.id)
                      }}
                      type="button"
                      data-handle="move"
                      data-mark-id={mark.id}
                      aria-label={`Signature ${String(index + 1)}`}
                      aria-describedby={`${id}-where-${mark.id}`}
                      aria-pressed={isSelected}
                      className={cx(
                        'absolute inset-0 cursor-move rounded-sm',
                        isSelected
                          ? 'outline-2 outline-offset-2 outline-accent'
                          : 'outline-1 outline-accent/50 outline-dashed',
                      )}
                      onFocus={() => {
                        setSelected(mark.id)
                      }}
                      onKeyDown={onKeyDown(mark.id)}
                    />
                    <span id={`${id}-where-${mark.id}`} className="sr-only">
                      {where(mark)}
                    </span>
                    {isSelected && (
                      <>
                        {/* Pointer-only: the buttons below and the keys do the same. */}
                        <span
                          aria-hidden="true"
                          data-handle="size"
                          data-mark-id={mark.id}
                          className="absolute right-0 bottom-0 flex size-11 translate-x-1/2 translate-y-1/2 cursor-nwse-resize items-center justify-center"
                        >
                          <span className="pointer-events-none block size-4 rounded-[3px] border-2 border-paper bg-accent shadow" />
                        </span>
                        <span
                          aria-hidden="true"
                          data-handle="turn"
                          data-mark-id={mark.id}
                          className="absolute bottom-full left-1/2 flex size-11 -translate-x-1/2 cursor-grab items-center justify-center"
                        >
                          <span className="pointer-events-none block size-4 rounded-full border-2 border-paper bg-accent shadow" />
                        </span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </PagePreview>
        </div>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            ref={addButton}
            onClick={() => {
              setMaking(true)
            }}
          >
            <SignIcon width={16} height={16} />
            {marks.length ? 'Add another' : 'Add a signature'}
          </Button>
          <div className="flex gap-1" role="group" aria-label="Selected signature">
            <IconButton
              label="Smaller"
              disabled={!current || atMin(current)}
              onClick={() => {
                if (current) resize(current.id, 1 / SIZE_STEP)
              }}
            >
              <MinusIcon width={16} height={16} />
            </IconButton>
            <IconButton
              label="Larger"
              disabled={!current || atMax(current)}
              onClick={() => {
                if (current) resize(current.id, SIZE_STEP)
              }}
            >
              <PlusIcon width={16} height={16} />
            </IconButton>
            <IconButton
              label="Turn left"
              disabled={!current || current.angle <= -MARK_ANGLE_LIMIT}
              onClick={() => {
                if (current) turn(current.id, -TURN_STEP)
              }}
            >
              <RotateLeftIcon width={16} height={16} />
            </IconButton>
            <IconButton
              label="Turn right"
              disabled={!current || current.angle >= MARK_ANGLE_LIMIT}
              onClick={() => {
                if (current) turn(current.id, TURN_STEP)
              }}
            >
              <RotateRightIcon width={16} height={16} />
            </IconButton>
            <IconButton
              label="Remove signature"
              disabled={!current}
              onClick={() => {
                if (current) remove(current.id)
              }}
            >
              <TrashIcon width={16} height={16} />
            </IconButton>
          </div>
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
                const kept = marks.filter((m) => all[m.assetId])
                const used = new Set(kept.map((m) => m.assetId))
                onApply(
                  kept,
                  Object.values(added).filter((a) => used.has(a.id)),
                )
                dialog.current?.close()
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
      {making && (
        <SignatureMaker
          store={store}
          onChoose={place}
          onClose={() => {
            setMaking(false)
            focusNext.current = placed.current ?? 'add'
            placed.current = null
          }}
        />
      )}
    </dialog>
  )
}
