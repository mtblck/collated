import type { Quad } from './perspective'

/**
 * When the scan camera (#118) takes the shot by itself: once the paper's
 * outline has held still for a moment. Fed one sighting per searched frame
 * (the corners found, or null); pure, so the timing is tested without a
 * camera.
 *
 * After a shot it waits for the page to change before it fires again: the
 * outline has to go (a hand turning the page covers it) or move well away.
 * Otherwise a page left under the camera would be taken over and over.
 */

export interface Sighting {
  /** Milliseconds, any clock that only goes forward. */
  at: number
  /** The paper's corners as fractions of the frame, or null when none was found. */
  corners: Quad | null
}

export interface Shutter {
  /** Recent sightings with paper, oldest first, all within STEADY_MS of the last. */
  recent: readonly Sighting[]
  /** Whether the next steady outline takes a shot. */
  armed: boolean
  /** When the last shot was taken, and of what. */
  shot: { at: number; corners: Quad | null } | null
}

/** How long the outline has to hold still. */
export const STEADY_MS = 800
/** How far (a share of the frame) any corner may wander and still count as still. */
export const STEADY_DRIFT = 0.02
/** A corner this far (share of the frame) from where it was shot means a new page. */
export const NEW_PAGE_SHIFT = 0.1
/** Never two shots closer than this, whatever the outline does. */
export const COOLDOWN_MS = 1500

export const SHUTTER_START: Shutter = { recent: [], armed: true, shot: null }

/** The largest distance any corner of `a` is from the same corner of `b`. */
export const cornerShift = (a: Quad, b: Quad) =>
  Math.max(...a.map((p, i) => Math.hypot(p.x - (b[i]?.x ?? 0), p.y - (b[i]?.y ?? 0))))

export interface ShutterStep {
  shutter: Shutter
  /** Take the shot now. */
  fire: boolean
  /** How far along holding still is (0–1), for the outline to show; 0 when not armed. */
  steady: number
}

/** The state after one more sighting, and whether to take the shot. */
export const sight = (state: Shutter, sighting: Sighting): ShutterStep => {
  const { at, corners } = sighting
  let { armed } = state
  const { shot } = state
  // Re-armed by the page going away or moving well off where it was shot.
  if (
    !armed &&
    (corners === null || (shot?.corners && cornerShift(corners, shot.corners) > NEW_PAGE_SHIFT))
  ) {
    armed = true
  }
  if (corners === null) return { shutter: { recent: [], armed, shot }, fire: false, steady: 0 }

  // Keep the run of sightings that are still close to this one.
  const kept: Sighting[] = []
  for (const s of state.recent) {
    if (at - s.at > STEADY_MS * 2) continue
    if (s.corners && cornerShift(s.corners, corners) <= STEADY_DRIFT) kept.push(s)
    else kept.length = 0 // a jump breaks the run
  }
  kept.push(sighting)
  // Only as far back as needed to cover STEADY_MS.
  while (kept.length > 1 && at - (kept[1]?.at ?? at) >= STEADY_MS) kept.shift()
  const held = at - (kept[0]?.at ?? at)
  const cooled = !shot || at - shot.at >= COOLDOWN_MS
  const steady = armed ? Math.min(1, held / STEADY_MS) : 0
  if (armed && cooled && held >= STEADY_MS) {
    return {
      shutter: { recent: [], armed: false, shot: { at, corners } },
      fire: true,
      steady: 1,
    }
  }
  return { shutter: { recent: kept, armed, shot }, fire: false, steady }
}

/**
 * A shot taken by hand (the shutter button): the same wait for a new page
 * follows, so auto-capture doesn't take the same page again right after.
 */
export const shotByHand = (state: Shutter, at: number, corners: Quad | null): Shutter => ({
  ...state,
  recent: [],
  armed: false,
  shot: { at, corners },
})
