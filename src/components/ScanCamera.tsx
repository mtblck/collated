import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { PaperGuess } from '../core/paper'
import type { Quad } from '../core/perspective'
import { SHUTTER_START, shotByHand, sight } from '../core/shutter'
import { Button, IconButton } from './controls'
import { cx } from './cx'
import { CameraIcon, CloseIcon, TorchIcon } from './Icons'
import { cameraProblem } from '../lib/camera'

/**
 * Scan mode (#118): the camera stays open over a stack of pages, outlines
 * the paper live and takes the shot once it holds still (or on the shutter).
 * Each shot goes to the document straight away, already cropped to the
 * outline. Unlike Take photo (#72) this needs camera permission, so it's the
 * second choice; when the camera can't be had, it offers Take photo instead.
 *
 * The frames never leave the device: a 320 px copy goes to the paper worker
 * (lib/paper.ts) a few times a second, and a shot is one full-size frame
 * drawn to a canvas and saved as a JPEG.
 */

/** The detector's working size (core/paper.ts): no point sending more. */
const FRAME_SIZE = 320
/** Pause between searches: about 6 a second, leaving the phone room for the preview. */
const FRAME_GAP_MS = 80
/** A manual shot uses the outline when it was seen this recently. */
const OUTLINE_FRESH_MS = 500
/** How long the white flash after a shot stays. */
const FLASH_MS = 180

/** Asks for the back camera at document resolution; the browser picks the closest it has. */
const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 2560 },
    height: { ideal: 1920 },
  },
}

/** "Scan 14.03.22.jpg", as Take photo names its shots by the time they were taken. */
const scanName = (at: Date) =>
  `Scan ${[at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join('.')}.jpg`

const subscribeVisibility = (onChange: () => void) => {
  document.addEventListener('visibilitychange', onChange)
  return () => {
    document.removeEventListener('visibilitychange', onChange)
  }
}
const useHidden = () =>
  useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'hidden',
    () => false,
  )

/** Chrome on Android offers the phone's light as `torch`; the DOM types don't know it. */
const hasTorch = (track: MediaStreamTrack | undefined) => {
  if (typeof track?.getCapabilities !== 'function') return false
  const caps: MediaTrackCapabilities & { torch?: boolean } = track.getCapabilities()
  return caps.torch === true
}

const stop = (stream: MediaStream | null) => {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

type Phase = 'starting' | 'live' | { problem: string }

export const ScanCamera = ({
  auto,
  onAuto,
  onShot,
  onTakePhoto,
  onClose,
  findPaper,
}: {
  /** Whether a steady outline takes the shot by itself (remembered by the app). */
  auto: boolean
  onAuto: (auto: boolean) => void
  /** A page taken, with the paper's corners when they were found. */
  onShot: (file: File, corners: Quad | null) => void
  /** Take photo (#72), offered when the camera can't be opened here. */
  onTakePhoto?: () => void
  onClose: () => void
  /** The paper in a downscaled frame (lib/paper.ts's paperInFrame); closes the bitmap. */
  findPaper: (frame: ImageBitmap) => Promise<PaperGuess | null>
}) => {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [outline, setOutline] = useState<Quad | null>(null)
  const [steady, setSteady] = useState(0)
  /** A page was just taken and the same one is still there. */
  const [waiting, setWaiting] = useState(false)
  const [taken, setTaken] = useState(0)
  const [flash, setFlash] = useState(false)
  const [torch, setTorch] = useState<{ track: MediaStreamTrack; on: boolean } | null>(null)
  const hidden = useHidden()

  // Read by the search loop, which outlives renders.
  const shutter = useRef(SHUTTER_START)
  const autoRef = useRef(auto)
  const seen = useRef<{ at: number; corners: Quad | null }>({ at: 0, corners: null })
  const onShotRef = useRef(onShot)
  const lastName = useRef({ base: '', count: 0 })
  useEffect(() => {
    autoRef.current = auto
    onShotRef.current = onShot
  })

  useEffect(() => {
    queueMicrotask(() => {
      const d = dialog.current
      if (d?.isConnected && !d.open) d.showModal()
    })
  }, [])

  // The camera runs only while the page is visible: a phone that locks or
  // switches app gets its camera back, and it starts again on return.
  useEffect(() => {
    const v = video.current
    if (hidden || !v) return
    let running = true
    // A function, so the check after each await isn't narrowed to constant.
    const stale = () => !running
    let stream: MediaStream | null = null
    navigator.mediaDevices.getUserMedia(CONSTRAINTS).then(
      async (s) => {
        if (stale()) {
          stop(s)
          return
        }
        stream = s
        v.srcObject = s
        try {
          await v.play()
        } catch {
          // Autoplay of a muted inline stream is allowed; a refusal here
          // still leaves frames to read once it plays.
        }
        if (stale()) return
        const track = s.getVideoTracks()[0]
        setTorch(track && hasTorch(track) ? { track, on: false } : null)
        setPhase('live')
      },
      (error: unknown) => {
        if (!stale()) setPhase({ problem: cameraProblem(error) })
      },
    )
    return () => {
      running = false
      stop(stream)
      v.srcObject = null
      setPhase('starting')
      setTorch(null)
      setOutline(null)
      setSteady(0)
      setWaiting(false)
      shutter.current = SHUTTER_START
    }
  }, [hidden])

  const shoot = useCallback((corners: Quad | null) => {
    const v = video.current
    if (!v || v.videoWidth === 0) return
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth
    canvas.height = v.videoHeight
    canvas.getContext('2d')?.drawImage(v, 0, 0)
    const at = new Date()
    setTaken((n) => n + 1)
    setFlash(true)
    setTimeout(() => {
      setFlash(false)
    }, FLASH_MS)
    if ('vibrate' in navigator) navigator.vibrate(15)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        // Two shots in one second get "(2)", so every page has its own name.
        const base = scanName(at)
        const n = lastName.current.base === base ? lastName.current.count + 1 : 1
        lastName.current = { base, count: n }
        const name = n === 1 ? base : base.replace(/\.jpg$/, ` (${n}).jpg`)
        onShotRef.current(
          new File([blob], name, { type: 'image/jpeg', lastModified: at.getTime() }),
          corners,
        )
      },
      'image/jpeg',
      0.92,
    )
  }, [])

  // The search: a small copy of the current frame to the paper worker, one
  // at a time, a short pause between.
  useEffect(() => {
    if (phase !== 'live') return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const small = document.createElement('canvas')
    const look = async () => {
      const v = video.current
      if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth > 0) {
        const scale = Math.min(1, FRAME_SIZE / Math.max(v.videoWidth, v.videoHeight))
        small.width = Math.max(1, Math.round(v.videoWidth * scale))
        small.height = Math.max(1, Math.round(v.videoHeight * scale))
        small.getContext('2d')?.drawImage(v, 0, 0, small.width, small.height)
        let guess: PaperGuess | null = null
        try {
          guess = await findPaper(await createImageBitmap(small))
        } catch {
          guess = null
        }
        if (!current) return
        const corners = guess?.corners ?? null
        const at = performance.now()
        seen.current = { at, corners }
        setOutline(corners)
        if (autoRef.current) {
          const step = sight(shutter.current, { at, corners })
          shutter.current = step.shutter
          setSteady(step.steady)
          setWaiting(!step.shutter.armed)
          if (step.fire) shoot(corners)
        } else {
          setSteady(0)
        }
      }
      if (current) timer = setTimeout(() => void look(), FRAME_GAP_MS)
    }
    void look()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [findPaper, phase, shoot])

  const shootByHand = () => {
    const now = performance.now()
    const corners = now - seen.current.at <= OUTLINE_FRESH_MS ? seen.current.corners : null
    shutter.current = shotByHand(shutter.current, now, corners)
    setSteady(0)
    setWaiting(true)
    shoot(corners)
  }

  const toggleTorch = () => {
    if (!torch) return
    const on = !torch.on
    torch.track
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(() => {
        setTorch((t) => (t ? { ...t, on } : t))
      })
      .catch(() => {
        setTorch(null) // it said it could, but can't
      })
  }

  const problem = typeof phase === 'object' ? phase.problem : null
  const hint =
    phase === 'starting'
      ? 'Starting the camera…'
      : !outline
        ? 'Hold the phone over a page, with all four corners in view.'
        : !auto
          ? 'Tap the shutter to take the page.'
          : waiting
            ? 'Got it. Turn to the next page.'
            : 'Hold still…'
  const points = (q: Quad) =>
    size ? q.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' ') : ''

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      className="m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden bg-black p-0 text-white backdrop:bg-black"
      onClose={onClose}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-3 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            Scan pages
          </h2>
          <div className="flex items-center gap-2">
            {torch && (
              <Button
                size="lg"
                variant="quiet"
                aria-pressed={torch.on}
                onClick={toggleTorch}
                className={cx(
                  'px-4 text-white hover:bg-white/10 hover:text-white',
                  torch.on && 'bg-white/20',
                )}
              >
                <TorchIcon />
                Light
              </Button>
            )}
            <IconButton
              label="Close the camera"
              onClick={() => dialog.current?.close()}
              className="size-11 text-white hover:bg-white/10 hover:text-white"
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-hidden="true"
            data-testid="scan-video"
            className="absolute inset-0 size-full object-contain"
            onLoadedMetadata={(e) => {
              setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })
            }}
            onResize={(e) => {
              setSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })
            }}
          />
          {/* Drawn in the video's own pixels, fitted the way the video is. */}
          {size && outline && (
            <svg
              className="pointer-events-none absolute inset-0 size-full"
              viewBox={`0 0 ${size.width} ${size.height}`}
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
              data-testid="scan-outline"
              data-steady={steady.toFixed(2)}
            >
              <polygon
                points={points(outline)}
                fill="var(--c-accent)"
                fillOpacity={0.12 + 0.25 * steady}
                stroke="var(--c-accent)"
                strokeWidth={3}
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          <div
            aria-hidden="true"
            className={cx(
              'pointer-events-none absolute inset-0 bg-white transition-opacity duration-150',
              flash ? 'opacity-70' : 'opacity-0',
            )}
          />
          {problem && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="max-w-sm text-lg">{problem}</p>
              {onTakePhoto && (
                <>
                  <p className="max-w-sm text-sm text-white/75">
                    Take photo opens your camera app instead, one page at a time.
                  </p>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => {
                      onTakePhoto()
                      dialog.current?.close()
                    }}
                  >
                    <CameraIcon />
                    Take photo instead
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {!problem && (
          <p className="px-4 pt-3 text-center text-sm text-white/85" aria-hidden="true">
            {hint}
          </p>
        )}
        <p role="status" aria-live="polite" className="pt-1 text-center text-xs text-white/70">
          {taken === 0 ? 'No pages yet' : `${taken} ${taken === 1 ? 'page' : 'pages'} taken`}
        </p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button
            size="lg"
            variant="quiet"
            aria-pressed={auto}
            inactive={problem !== null}
            onClick={() => {
              onAuto(!auto)
            }}
            className={cx(
              'justify-self-start px-4 text-white hover:bg-white/10 hover:text-white',
              auto && 'bg-white/20',
            )}
          >
            Auto
            {/* Seen, not read: the button's pressed state says it. */}
            <span aria-hidden="true" className="text-white/75">
              {auto ? 'on' : 'off'}
            </span>
          </Button>
          <button
            type="button"
            aria-label="Take the page"
            disabled={phase !== 'live'}
            onClick={shootByHand}
            className="size-[4.5rem] rounded-full border-4 border-white bg-white/25 transition active:scale-95 active:bg-white/60 disabled:opacity-40"
          />
          <Button
            size="lg"
            variant={taken > 0 ? 'primary' : 'quiet'}
            onClick={() => dialog.current?.close()}
            className={cx('justify-self-end px-4', taken === 0 && 'text-white hover:bg-white/10')}
          >
            Done
          </Button>
        </div>
      </div>
    </dialog>
  )
}
