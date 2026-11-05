import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { INKS, penWidth, type Ink, type StrokePoint } from '../core/signature'
import {
  NoSignatureFound,
  SIGNATURE_FONT,
  photoToPng,
  trimToPng,
  typedToPng,
  type SignaturePng,
} from '../lib/signatureCanvas'
import type { SavedSignature, SignatureStore } from '../state/signatureStore'
import { useTouchDevice } from '../hooks/useTouchDevice'
import { Button, IconButton, Segmented } from './controls'
import { CameraIcon, TrashIcon, UndoIcon } from './Icons'
import { cx } from './cx'

type Tab = 'saved' | 'draw' | 'type' | 'photo'

/** Pen width as a share of the pad's width, so a signature looks the same on a phone and a desk. */
const PEN = 0.007

const mid = (a: StrokePoint, b: StrokePoint): StrokePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  pressure: (a.pressure + b.pressure) / 2,
})

const setPen = (ctx: CanvasRenderingContext2D, ink: Ink) => {
  ctx.strokeStyle = ctx.fillStyle = INKS[ink]
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
}

/**
 * Part of a stroke onto the pad's canvas: segments `from` up to (not
 * including) `to`. Points are fractions of the pad's width (both axes), so a
 * resize redraws the same signature. A stroke is smoothed through its points'
 * midpoints, so segment i runs from the middle of points i−1 and i to the
 * middle of points i and i+1 (the last one to the last point), its width
 * following the pen.
 */
const paintStroke = (
  ctx: CanvasRenderingContext2D,
  stroke: readonly StrokePoint[],
  width: number,
  from = 1,
  to = stroke.length,
) => {
  const base = Math.max(1.5, width * PEN)
  const at = (p: StrokePoint) => [p.x * width, p.y * width] as const
  const [first] = stroke
  if (!first) return
  if (stroke.length === 1) {
    const [x, y] = at(first)
    ctx.beginPath()
    ctx.arc(x, y, penWidth(base, first.pressure) / 2, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  for (let i = Math.max(1, from); i < to; i++) {
    const before = stroke[i - 1]
    const p = stroke[i]
    if (!before || !p) continue
    const start = i === 1 ? before : mid(before, p)
    const next = stroke[i + 1]
    const end = next ? mid(p, next) : p
    ctx.beginPath()
    ctx.lineWidth = penWidth(base, p.pressure)
    ctx.moveTo(...at(start))
    ctx.quadraticCurveTo(...at(p), ...at(end))
    ctx.stroke()
  }
}

/**
 * The drawing pad: a canvas that fills the space it's given, drawn on with a
 * finger, pen or mouse. Touch never scrolls the page while drawing.
 */
const DrawPad = ({
  ink,
  strokes,
  onStrokes,
  onStart,
  canvasRef,
  labelledBy,
}: {
  ink: Ink
  strokes: StrokePoint[][]
  onStrokes: React.Dispatch<React.SetStateAction<StrokePoint[][]>>
  /** A stroke has begun. */
  onStart: () => void
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  labelledBy: string
}) => {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  /** The stroke being drawn: painted as it goes, and added to `strokes` when the pen lifts. */
  const live = useRef<{ pointerId: number; stroke: StrokePoint[] } | null>(null)
  const [drawing, setDrawing] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [])

  const ratio = typeof devicePixelRatio === 'number' ? Math.min(3, devicePixelRatio) : 1
  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    setPen(ctx, ink)
    for (const stroke of strokes) paintStroke(ctx, stroke, size.width)
  }, [canvasRef, ink, ratio, size.width, strokes])
  useLayoutEffect(repaint, [repaint])

  const pointOf = (event: React.PointerEvent | PointerEvent): StrokePoint | null => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return null
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.width,
      pressure: event.pointerType === 'pen' ? event.pressure : 0.5,
    }
  }

  return (
    <div ref={box} className="relative min-h-0 flex-1">
      <canvas
        ref={canvasRef}
        aria-labelledby={labelledBy}
        data-signature-pad
        width={Math.max(1, Math.round(size.width * ratio))}
        height={Math.max(1, Math.round(size.height * ratio))}
        className="absolute inset-0 h-full w-full cursor-crosshair touch-none rounded-xl bg-white select-none"
        onPointerDown={(event) => {
          if (live.current || (event.pointerType === 'mouse' && event.button !== 0)) return
          const p = pointOf(event)
          if (!p) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          live.current = { pointerId: event.pointerId, stroke: [p] }
          setDrawing(true)
          onStart()
        }}
        onPointerMove={(event) => {
          const current = live.current
          if (current?.pointerId !== event.pointerId) return
          const native = event.nativeEvent
          // Every point the pen passed since the last frame, where the browser keeps them.
          const events = 'getCoalescedEvents' in native ? native.getCoalescedEvents() : []
          const before = current.stroke.length
          for (const e of events.length ? events : [native]) {
            const p = pointOf(e)
            if (p) current.stroke.push(p)
          }
          // Only the new segments that end where they will stay (a segment's
          // end moves until the point after it is known); the pen lifting
          // repaints the whole stroke.
          const ctx = event.currentTarget.getContext('2d')
          if (!ctx) return
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
          setPen(ctx, ink)
          paintStroke(ctx, current.stroke, size.width, before - 1, current.stroke.length - 1)
        }}
        onPointerUp={(event) => {
          const current = live.current
          if (current?.pointerId !== event.pointerId) return
          live.current = null
          setDrawing(false)
          onStrokes((all) => [...all, current.stroke])
        }}
        onPointerCancel={(event) => {
          if (live.current?.pointerId !== event.pointerId) return
          live.current = null
          setDrawing(false)
          repaint()
        }}
      />
      {/* The line to sign on, as on paper. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[8%] bottom-[28%] left-[8%] border-b border-dashed border-[#9a8f84]"
      />
      {strokes.length === 0 && !drawing && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-[12%] text-center text-sm text-[#6b625a]"
        >
          Sign here
        </p>
      )}
    </div>
  )
}

const pngUrl = (png: Uint8Array) =>
  URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))

/** Object URLs for saved signatures' previews, revoked when they go. */
const useSavedUrls = (saved: readonly SavedSignature[]) => {
  const urls = useMemo(
    () => Object.fromEntries(saved.map((s) => [s.id, pngUrl(s.png)])) as Record<string, string>,
    [saved],
  )
  useEffect(
    () => () => {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url)
    },
    [urls],
  )
  return urls
}

/** When a signature was saved (outside render, for the hooks linter). */
const now = () => Date.now()

/**
 * Makes or picks a signature (#111): draw it with a finger, pen or mouse,
 * type it in a script face, or take a photo of one signed on paper (the
 * paper goes transparent). A new one can be saved on this device for next
 * time; saved ones are picked or deleted here. A native modal dialog that
 * fills a phone's screen, so the pad is as big as it can be.
 */
export const SignatureMaker = ({
  store,
  onChoose,
  onClose,
}: {
  store: SignatureStore
  onChoose: (signature: SavedSignature) => void
  onClose: () => void
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const touch = useTouchDevice()
  const [saved, setSaved] = useState<SavedSignature[] | null>(null)
  const [tab, setTab] = useState<Tab>('draw')
  const [ink, setInk] = useState<Ink>('black')
  // Off unless chosen: on a shared computer, nothing is kept by surprise.
  const [keep, setKeep] = useState(false)
  /** Drawing, typing or a photo has begun: the saved list mustn't take over. */
  const started = useRef(false)
  const [strokes, setStrokes] = useState<StrokePoint[][]>([])
  const [typed, setTyped] = useState('')
  const [photo, setPhoto] = useState<{ png: SignaturePng; url: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const urls = useSavedUrls(saved ?? [])

  useEffect(() => {
    // After the effects of this render: opened over the sign editor, which
    // opens its own dialog in its effect, after this child's. The top layer
    // stacks in the order dialogs open.
    queueMicrotask(() => {
      const d = dialog.current
      if (d?.isConnected && !d.open) d.showModal()
    })
  }, [])

  useEffect(() => {
    let current = true
    store.list().then(
      (all) => {
        if (!current) return
        setSaved(all)
        // Unless they've already started on a new one.
        if (all.length && !started.current) setTab('saved')
      },
      () => {
        if (current) setSaved([])
      },
    )
    return () => {
      current = false
    }
  }, [store])

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url)
    },
    [photo],
  )

  const choose = (signature: SavedSignature) => {
    onChoose(signature)
    dialog.current?.close()
  }

  const finish = async () => {
    setError('')
    setBusy(true)
    try {
      let made: SignaturePng | null = null
      if (tab === 'draw' && canvas.current) made = await trimToPng(canvas.current)
      if (tab === 'type') made = await typedToPng(typed, ink)
      if (tab === 'photo') made = photo?.png ?? null
      if (!made) {
        setError(
          tab === 'draw'
            ? 'Draw your signature first.'
            : tab === 'type'
              ? 'Type your name first.'
              : 'Choose a photo first.',
        )
        return
      }
      const signature: SavedSignature = { id: crypto.randomUUID(), ...made, savedAt: now() }
      // Saving is a convenience: a failure (private mode, full disk) still signs.
      if (keep) await store.save(signature).catch(() => undefined)
      choose(signature)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const readPhoto = async (file: File | undefined) => {
    if (!file) return
    started.current = true
    setError('')
    setBusy(true)
    try {
      const png = await photoToPng(file)
      setPhoto({ png, url: pngUrl(png.png) })
      setAnnouncement('Signature found in the photo. The paper is now transparent.')
    } catch (err) {
      setPhoto(null)
      setError(
        err instanceof NoSignatureFound
          ? err.message
          : 'That picture couldn’t be read. Try a JPEG or PNG photo.',
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async (signature: SavedSignature, index: number) => {
    await store.remove(signature.id).catch(() => undefined)
    const rest = (saved ?? []).filter((s) => s.id !== signature.id)
    setSaved(rest)
    setAnnouncement(`Saved signature ${String(index + 1)} deleted from this device.`)
    if (!rest.length) setTab('draw')
  }

  const tabs: { value: Tab; label: string }[] = [
    ...(saved?.length ? [{ value: 'saved' as const, label: 'Saved' }] : []),
    { value: 'draw', label: 'Draw' },
    { value: 'type', label: 'Type' },
    { value: 'photo', label: 'Photo' },
  ]

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      className={cx(
        'm-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-paper p-0 text-ink backdrop:bg-black/50',
        'sm:m-auto sm:h-[min(40rem,calc(100dvh-2rem))] sm:w-[min(44rem,calc(100vw-2rem))] sm:rounded-2xl sm:shadow-panel',
      )}
      onClose={onClose}
    >
      <div className="flex h-full flex-col gap-3 p-4 sm:gap-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
            Add a signature
          </h2>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => {
              dialog.current?.close()
            }}
          >
            Cancel
          </Button>
        </div>

        <Segmented
          legend="How to sign"
          hideLegend
          value={tab}
          options={tabs}
          onChange={(next) => {
            setError('')
            started.current = true
            setTab(next)
          }}
        />

        {tab === 'saved' && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="mb-3 text-sm text-ink-muted">
              Saved on this device only. Tap one to put it on the page.
            </p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(saved ?? []).map((signature, i) => (
                <li key={signature.id} className="relative">
                  <button
                    type="button"
                    data-saved-signature
                    className="flex h-24 w-full items-center justify-center rounded-xl border border-rule bg-white p-3 hover:border-accent focus-visible:outline-offset-2"
                    aria-label={`Use saved signature ${String(i + 1)}`}
                    onClick={() => {
                      choose(signature)
                    }}
                  >
                    {urls[signature.id] && (
                      <img
                        src={urls[signature.id]}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </button>
                  <IconButton
                    label={`Delete saved signature ${String(i + 1)} from this device`}
                    className="absolute top-1 right-1"
                    onClick={() => {
                      void remove(signature, i)
                    }}
                  >
                    <TrashIcon width={16} height={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === 'draw' && (
          <>
            <p id={`${id}-pad`} className="text-sm text-ink-muted">
              Sign in the box with your finger, a pen or the mouse.
              {touch && ' Turn your phone sideways for more room.'}
            </p>
            <DrawPad
              ink={ink}
              strokes={strokes}
              onStrokes={setStrokes}
              onStart={() => {
                started.current = true
              }}
              canvasRef={canvas}
              labelledBy={`${id}-pad`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!strokes.length}
                onClick={() => {
                  setStrokes(strokes.slice(0, -1))
                  setAnnouncement('Last stroke undone.')
                }}
              >
                <UndoIcon width={16} height={16} />
                Undo stroke
              </Button>
              <Button
                size="sm"
                variant="quiet"
                disabled={!strokes.length}
                onClick={() => {
                  setStrokes([])
                  setAnnouncement('Pad cleared.')
                }}
              >
                Clear
              </Button>
            </div>
          </>
        )}

        {tab === 'type' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="label text-ink-faint">Your name</span>
              <input
                type="text"
                value={typed}
                maxLength={80}
                autoComplete="name"
                enterKeyHint="done"
                className="h-11 rounded-lg border border-control bg-paper px-3 text-base text-ink"
                onChange={(event) => {
                  started.current = true
                  setTyped(event.target.value)
                }}
              />
            </label>
            <div
              aria-hidden="true"
              className="flex min-h-24 flex-1 items-center justify-center overflow-hidden rounded-xl bg-white px-4"
            >
              <span
                className="max-w-full truncate leading-normal"
                style={{
                  fontFamily: SIGNATURE_FONT,
                  fontSize: 'clamp(2rem, 9vw, 3.5rem)',
                  color: INKS[ink],
                }}
              >
                {typed.trim() || 'Your name'}
              </span>
            </div>
          </div>
        )}

        {tab === 'photo' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <p className="text-sm text-ink-muted">
              Sign on plain white paper and photograph it close up. The paper is made transparent;
              the photo never leaves this device.
            </p>
            <div className="flex flex-wrap gap-2">
              {touch && (
                <Button
                  onClick={() => {
                    cameraInput.current?.click()
                  }}
                >
                  <CameraIcon width={16} height={16} />
                  Take a photo
                </Button>
              )}
              <Button
                onClick={() => {
                  photoInput.current?.click()
                }}
              >
                Choose a picture
              </Button>
            </div>
            <div className="flex min-h-24 flex-1 items-center justify-center rounded-xl bg-white p-4">
              {photo ? (
                <img
                  src={photo.url}
                  alt="The signature from the photo, on a transparent background"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-sm text-[#6b625a]">
                  {busy ? 'Finding the signature…' : 'No photo yet'}
                </span>
              )}
            </div>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              hidden
              data-testid="signature-photo-input"
              onChange={(event) => {
                void readPhoto(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) => {
                void readPhoto(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
        )}

        {tab !== 'saved' && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            {tab !== 'photo' && (
              <Segmented
                legend="Ink"
                value={ink}
                options={[
                  { value: 'black', label: 'Black' },
                  { value: 'blue', label: 'Blue' },
                ]}
                onChange={setInk}
              />
            )}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={keep}
                onChange={(event) => {
                  setKeep(event.target.checked)
                }}
              />
              Save on this device for next time
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        {tab !== 'saved' && (
          <Button
            variant="primary"
            size="lg"
            className="w-full sm:ml-auto sm:w-auto"
            inactive={busy}
            onClick={() => {
              void finish()
            }}
          >
            Use this signature
          </Button>
        )}
      </div>
    </dialog>
  )
}
