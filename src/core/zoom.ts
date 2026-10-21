/**
 * Zoom and pan for the page viewer, as a transform about the stage's centre:
 * the content is scaled by `scale`, then moved by (`x`, `y`) pixels.
 */
export interface View {
  scale: number
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8
export const FIT: View = { scale: 1, x: 0, y: 0 }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * Keeps the content covering the stage once zoomed in: at `scale` it is
 * `scale` times the stage, so it may move (scale − 1) / 2 of the stage each way.
 */
export const clampView = (view: View, stage: { width: number; height: number }): View => {
  const scale = clamp(view.scale, MIN_ZOOM, MAX_ZOOM)
  const maxX = ((scale - 1) * stage.width) / 2
  const maxY = ((scale - 1) * stage.height) / 2
  return { scale, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) }
}

/**
 * Zooms to `scale`, keeping the content under `at` (stage pixels from its
 * centre) where it is: what you pinch or point at stays under your fingers.
 */
export const zoomAt = (
  view: View,
  scale: number,
  at: { x: number; y: number },
  stage: { width: number; height: number },
): View => {
  const next = clamp(scale, MIN_ZOOM, MAX_ZOOM)
  const k = next / view.scale
  return clampView(
    { scale: next, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k },
    stage,
  )
}

/** The zoom steps the buttons and keys go through. */
export const STEPS = [1, 1.5, 2, 3, 4, 6, 8] as const

export const stepFrom = (scale: number, direction: 1 | -1) => {
  if (direction > 0) return STEPS.find((s) => s > scale + 1e-6) ?? MAX_ZOOM
  return [...STEPS].reverse().find((s) => s < scale - 1e-6) ?? MIN_ZOOM
}
