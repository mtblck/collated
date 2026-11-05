import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { SheetLayout } from '../core/geometry'
import {
  MARK_ANGLE_LIMIT,
  MARK_COLOURS,
  TEXT_MAX_LENGTH,
  cleanMark,
  isImageMark,
  markBox,
  markReady,
  markTextProblems,
  newSignature,
  newStamp,
  newText,
  placedMarks,
  sizeLimits,
  sizeOf,
  todayText,
  withSize,
} from '../core/marks'
import type { Asset, Mark } from '../core/model'
import type { NumberMark } from '../core/pageNumbers'
import type { Quad } from '../core/perspective'
import type { WatermarkMark } from '../core/watermark'
import { assetStore } from '../import/assetStore'
import type { SavedSignature, SignatureStore } from '../state/signatureStore'
import { Button, IconButton } from './controls'
import {
  CalendarIcon,
  CheckIcon,
  CrossMarkIcon,
  MinusIcon,
  PlusIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SignIcon,
  TextIcon,
  TrashIcon,
} from './Icons'
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

const KIND_NAMES: Record<Mark['kind'], string> = {
  signature: 'Signature',
  text: 'Text',
  tick: 'Tick',
  cross: 'Cross',
}

/**
 * The part of the screen the page can use: on a phone, the on-screen
 * keyboard covers the bottom of the layout viewport without shrinking it
 * (iOS, and Android Chrome by default), so the dialog follows the visual
 * viewport instead and the text being typed stays above the keyboard.
 */
const useVisibleHeight = () => {
  const [view, setView] = useState<{ height: number; top: number; keyboard: boolean } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const read = () => {
      // Zoomed in, the visual viewport is a magnifier, not what's left of the screen.
      if (Math.abs(vv.scale - 1) > 0.01) {
        setView(null)
        return
      }
      const keyboard = window.innerHeight - vv.height > 120
      setView(keyboard ? { height: vv.height, top: vv.offsetTop, keyboard } : null)
    }
    read()
    vv.addEventListener('resize', read)
    vv.addEventListener('scroll', read)
    return () => {
      vv.removeEventListener('resize', read)
      vv.removeEventListener('scroll', read)
    }
  }, [])
  return view
}

/**
 * Puts signatures (#111), text, dates, ticks and crosses (#112) on a page:
 * the page as it will print, with each mark drawn where the export puts it.
 * A native modal dialog that fills a phone's screen; nothing changes until
 * Apply, so the whole visit is one undo step.
 *
 * Every gesture has a one-finger or keyboard way too (WCAG 2.5.1, 2.5.7):
 * drag a mark to move it, its corner to size it, the knob above it to turn
 * it, or pinch with two fingers to do both; or tap the page to move the
 * selected one there, and use Smaller, Larger and the turn buttons; or the
 * arrow keys, + and −, [ and ] (Shift for bigger steps), Delete to remove.
 * Text is typed in a box under the page, which stays above a phone's
 * on-screen keyboard (`useVisibleHeight`).
 */
export const MarkEditor = ({
  title,
  sheet,
  thumbUrls,
  covers,
  watermark = null,
  numbers = null,
  initial,
  start = 'sign',
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
  /** With nothing on the page yet: open the signature pad (`sign`), or the page itself (`fill`). */
  start?: 'sign' | 'fill'
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
  const textBox = useRef<HTMLTextAreaElement>(null)
  const markRefs = useRef(new Map<string, HTMLButtonElement>())
  const [marks, setMarks] = useState<Mark[]>(() => [...initial])
  const [added, setAdded] = useState<Record<string, Asset>>({})
  const [selected, setSelected] = useState<string | null>(initial[0]?.id ?? null)
  // Signing an empty page starts by making or picking a signature.
  const [making, setMaking] = useState(start === 'sign' && initial.length === 0)
  const visible = useVisibleHeight()
  const [announcement, setAnnouncement] = useState('')
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const focusNext = useRef<string | null>(null)
  /** The signature just placed from the maker, focused once it closes. */
  const placed = useRef<string | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const all = { ...assets, ...added }
  const { page } = sheet
  const current = marks.find((m) => m.id === selected)

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
    else if (key === 'text') textBox.current?.focus()
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

  /** "Signature 1", "Tick 2": counted within its kind, in the order they were added. */
  const nameOf = (markId: string, list: readonly Mark[] = marks) => {
    const mark = list.find((m) => m.id === markId)
    if (!mark) return ''
    const same = list.filter((m) => m.kind === mark.kind)
    return `${KIND_NAMES[mark.kind]} ${String(same.indexOf(mark) + 1)}`
  }
  const where = (mark: Mark) => {
    const size =
      mark.kind === 'text'
        ? `${String(Math.round(mark.size * page.width))} pt`
        : `${percent(mark.width)} of the page wide`
    const turned = mark.angle ? `, turned ${String(Math.round(mark.angle))}°` : ''
    const says = mark.kind === 'text' ? `“${mark.text.trim() || 'empty'}”, ` : ''
    return `${says}${percent(mark.x)} across, ${percent(mark.y)} down, ${size}${turned}`
  }

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
      `${nameOf(markId)} removed. ${rest.length ? `${String(rest.length)} left` : 'Nothing on the page'}.`,
    )
  }

  /** Where a new text or stamp goes: the middle of the page, each one a little lower. */
  const spot = () => ({ x: 0.5, y: 0.4 + (marks.length % 8) * 0.06 })

  const add = (mark: Mark, focus: 'mark' | 'text') => {
    setMarks((list) => [...list, mark])
    setSelected(mark.id)
    focusNext.current = focus === 'text' ? 'text' : mark.id
    const name = nameOf(mark.id, [...marks, mark])
    announce(
      `${name} added in the middle of the page. ${focus === 'text' ? 'Type it, then tap' : 'Tap'} the page where it goes, or drag it; arrow keys move it.`,
    )
  }
  const colourNow = () => (current && !isImageMark(current) ? current.colour : undefined)

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
      // A second finger: pinch the selected mark (or the one being dragged).
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
          ...withSize(g.from, sizeOf(g.from) * (fingers.distance / g.distance)),
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
      if (start > 0) update(g.id, () => withSize(from, (sizeOf(from) * now) / start), false)
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
    // A tap on the page puts the selected mark there.
    const rect = frame()
    const mark = marks.find((m) => m.id === selected)
    if (g.moved || !rect || !mark) return
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    update(mark.id, (m) => ({ ...m, x, y }), false)
    announce(`${nameOf(mark.id)} moved, ${where(cleanMark({ ...mark, x, y }))}.`)
  }

  const resize = (markId: string, factor: number) => {
    update(markId, (m) => withSize(m, sizeOf(m) * factor))
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

  const atMin = (mark: Mark) => sizeOf(mark) <= sizeLimits(mark).min + 1e-9
  const atMax = (mark: Mark) => sizeOf(mark) >= sizeLimits(mark).max - 1e-9
  const boxOf = (mark: Mark) =>
    markBox(mark, page, isImageMark(mark) ? all[mark.assetId] : undefined)
  const problems = [...new Set(marks.flatMap(markTextProblems))]

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-help`}
      className={cx(
        'm-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-paper p-0 text-ink backdrop:bg-black/50',
        'sm:m-auto sm:h-[calc(100dvh-2rem)] sm:w-[min(60rem,calc(100vw-2rem))] sm:rounded-2xl sm:shadow-panel',
      )}
      // Above a phone's keyboard while text is typed (see useVisibleHeight).
      style={
        visible
          ? {
              height: `${String(visible.height)}px`,
              top: `${String(visible.top)}px`,
              bottom: 'auto',
              marginTop: 0,
              marginBottom: 0,
            }
          : undefined
      }
      data-keyboard={visible ? '' : undefined}
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
          <p id={`${id}-help`} className={cx('mt-1 text-sm text-ink-muted', visible && 'sr-only')}>
            Add a signature, text, today’s date, a tick or a cross, then drag it into place or tap
            the page where it goes. Pinch, or drag its corner, to size it; drag the knob above it to
            turn it. Keys: arrows move, + and − size, [ and ] turn, Delete removes.
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
              {/* The marks themselves are drawn by the preview, under the
                  watermark and page number as printed; these are their handles. */}
              {marks.map((mark) => {
                const box = boxOf(mark)
                if (!box) return null
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
                      aria-label={nameOf(mark.id)}
                      aria-describedby={`${id}-where-${mark.id}`}
                      aria-pressed={isSelected}
                      className={cx(
                        // Small marks (a tick) still get a finger-sized target.
                        'absolute top-1/2 left-1/2 h-full min-h-6 w-full min-w-6 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-sm',
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

        {current?.kind === 'text' && (
          <div>
            <label htmlFor={`${id}-text`} className="sr-only">
              {`${nameOf(current.id)}: what it says`}
            </label>
            <textarea
              ref={textBox}
              id={`${id}-text`}
              data-mark-text
              rows={Math.min(4, current.text.split('\n').length)}
              maxLength={TEXT_MAX_LENGTH}
              placeholder="Type here"
              value={current.text}
              aria-invalid={problems.length > 0}
              aria-describedby={problems.length ? `${id}-problem` : undefined}
              // 16px, or iOS zooms the page in when it's focused.
              className="border-line block w-full resize-none rounded-lg border bg-paper px-3 py-2 text-base"
              onChange={(event) => {
                const text = event.target.value
                update(current.id, (m) => ({ ...m, text }), false)
              }}
            />
          </div>
        )}
        {problems.length > 0 && (
          <p id={`${id}-problem`} role="alert" className="text-sm text-danger">
            {`The text’s font can’t write ${problems.join(' ')}. Use Latin letters.`}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add">
            <Button
              ref={addButton}
              size="sm"
              onClick={() => {
                setMaking(true)
              }}
            >
              <SignIcon width={16} height={16} />
              Signature
            </Button>
            <Button
              size="sm"
              onClick={() => {
                add(newText(crypto.randomUUID(), page, spot(), '', colourNow()), 'text')
              }}
            >
              <TextIcon width={16} height={16} />
              Text
            </Button>
            <Button
              size="sm"
              onClick={() => {
                add(newText(crypto.randomUUID(), page, spot(), todayText(), colourNow()), 'mark')
              }}
            >
              <CalendarIcon width={16} height={16} />
              Date
            </Button>
            <IconButton
              label="Tick"
              variant="secondary"
              onClick={() => {
                add(newStamp(crypto.randomUUID(), 'tick', page, spot(), colourNow()), 'mark')
              }}
            >
              <CheckIcon width={16} height={16} />
            </IconButton>
            <IconButton
              label="Cross"
              variant="secondary"
              onClick={() => {
                add(newStamp(crypto.randomUUID(), 'cross', page, spot(), colourNow()), 'mark')
              }}
            >
              <CrossMarkIcon width={16} height={16} />
            </IconButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={current ? nameOf(current.id) : 'Selected'}
          >
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
              label={current ? `Remove ${nameOf(current.id).toLowerCase()}` : 'Remove'}
              disabled={!current}
              onClick={() => {
                if (current) remove(current.id)
              }}
            >
              <TrashIcon width={16} height={16} />
            </IconButton>
          </div>
          {current && !isImageMark(current) && (
            <div className="flex gap-1" role="radiogroup" aria-label="Colour">
              {MARK_COLOURS.map((colour) => (
                <button
                  key={colour.hex}
                  type="button"
                  role="radio"
                  aria-checked={current.colour === colour.hex}
                  aria-label={colour.name}
                  title={colour.name}
                  className={cx(
                    'flex size-9 items-center justify-center rounded-full',
                    current.colour === colour.hex && 'ring-2 ring-accent',
                  )}
                  onClick={() => {
                    update(current.id, (m) => ({ ...m, colour: colour.hex }), false)
                    announce(`${nameOf(current.id)} in ${colour.name.toLowerCase()}.`)
                  }}
                >
                  <span
                    className="block size-5 rounded-full border border-paper"
                    style={{ background: colour.hex }}
                  />
                </button>
              ))}
            </div>
          )}
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
              inactive={problems.length > 0}
              {...(problems.length ? { 'aria-describedby': `${id}-problem` } : {})}
              onClick={() => {
                const kept = marks.filter((m) => markReady(m, all))
                const used = new Set(kept.flatMap((m) => (isImageMark(m) ? [m.assetId] : [])))
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
