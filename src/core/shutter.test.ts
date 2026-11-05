import { describe, expect, it } from 'vitest'
import type { Quad } from './perspective'
import {
  COOLDOWN_MS,
  REARM_MS,
  SHUTTER_START,
  STEADY_MS,
  cornerShift,
  shotByHand,
  sight,
  type Shutter,
} from './shutter'

const quad = (dx = 0, dy = 0): Quad => [
  { x: 0.2 + dx, y: 0.1 + dy },
  { x: 0.8 + dx, y: 0.1 + dy },
  { x: 0.8 + dx, y: 0.9 + dy },
  { x: 0.2 + dx, y: 0.9 + dy },
]

/** Feeds sightings every `step` ms from `from`; the times at which it fired. */
const run = (
  start: Shutter,
  from: number,
  to: number,
  corners: (t: number) => Quad | null,
  step = 100,
) => {
  let state = start
  const fired: number[] = []
  for (let at = from; at <= to; at += step) {
    const next = sight(state, { at, corners: corners(at) })
    state = next.shutter
    if (next.fire) fired.push(at)
  }
  return { state, fired }
}

describe('cornerShift', () => {
  it('is the farthest any corner moved', () => {
    expect(cornerShift(quad(), quad())).toBe(0)
    expect(cornerShift(quad(), quad(0.03, 0.04))).toBeCloseTo(0.05)
  })
})

describe('sight', () => {
  it('fires once the outline has held still for STEADY_MS', () => {
    const { fired } = run(SHUTTER_START, 0, 2000, () => quad())
    expect(fired).toEqual([STEADY_MS])
  })

  it('tolerates a little jitter', () => {
    const { fired } = run(SHUTTER_START, 0, 1000, (t) => quad((t % 200 === 0 ? 1 : -1) * 0.005))
    expect(fired).toEqual([STEADY_MS])
  })

  it('waits while the outline keeps moving', () => {
    const { fired } = run(SHUTTER_START, 0, 3000, (t) => quad(t / 10_000))
    expect(fired).toEqual([])
  })

  it('starts over when the paper is lost', () => {
    const { fired } = run(SHUTTER_START, 0, 2000, (t) => (t === 500 ? null : quad()))
    expect(fired).toEqual([500 + 100 + STEADY_MS])
  })

  it('reports how far along holding still is', () => {
    let state = SHUTTER_START
    const steady: number[] = []
    for (const at of [0, 200, 400]) {
      const next = sight(state, { at, corners: quad() })
      state = next.shutter
      steady.push(next.steady)
    }
    expect(steady).toEqual([0, 0.25, 0.5])
    expect(sight(state, { at: 500, corners: null }).steady).toBe(0)
  })

  it('does not take the same page twice', () => {
    const { fired } = run(SHUTTER_START, 0, 10_000, () => quad())
    expect(fired).toHaveLength(1)
  })

  it('takes the next page after the outline goes and comes back', () => {
    // Page 1 held from 0; a hand covers it 2000–2400; page 2 from 2500.
    const { fired } = run(SHUTTER_START, 0, 5000, (t) => (t >= 2000 && t < 2500 ? null : quad()))
    expect(fired).toEqual([STEADY_MS, 2500 + STEADY_MS])
  })

  it('takes the next page when the outline moves well away', () => {
    const { fired } = run(SHUTTER_START, 0, 5000, (t) => (t < 2000 ? quad() : quad(0.15)))
    expect(fired).toEqual([STEADY_MS, 2000 + STEADY_MS])
  })

  it('takes a page once even when the detector misses a frame of it', () => {
    const { fired } = run(SHUTTER_START, 0, 6000, (t) => (t === 1500 || t === 3000 ? null : quad()))
    expect(fired).toEqual([STEADY_MS])
  })

  it('keeps shots at least COOLDOWN_MS apart', () => {
    // The page leaves and comes back straight after the first shot.
    const gone = (t: number) => t >= 900 && t < 900 + REARM_MS + 100
    const { fired } = run(SHUTTER_START, 0, 4000, (t) => (gone(t) ? null : quad()))
    expect(fired[0]).toBe(STEADY_MS)
    expect((fired[1] ?? Infinity) - (fired[0] ?? 0)).toBeGreaterThanOrEqual(COOLDOWN_MS)
  })

  it('forgets sightings from long ago (a paused camera)', () => {
    const first = sight(SHUTTER_START, { at: 0, corners: quad() }).shutter
    const { fire } = sight(first, { at: 60_000, corners: quad() })
    expect(fire).toBe(false)
  })
})

describe('shotByHand', () => {
  it('waits for a new page before firing by itself', () => {
    const after = shotByHand(SHUTTER_START, 0, quad())
    expect(run(after, 100, 5000, () => quad()).fired).toEqual([])
    expect(run(after, 100, 5000, (t) => (t < 1000 ? null : quad())).fired).toEqual([
      1000 + STEADY_MS,
    ])
  })
})
