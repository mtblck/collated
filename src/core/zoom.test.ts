import { describe, expect, it } from 'vitest'
import { FIT, clampView, stepFrom, zoomAt } from './zoom'

const stage = { width: 800, height: 600 }

describe('viewer zoom', () => {
  it('keeps the point under the fingers still while zooming', () => {
    const at = { x: 200, y: -100 } // from the stage centre
    const zoomed = zoomAt(FIT, 2, at, stage)
    // Content point under `at` before: (at - t) / s = (200, -100). After:
    expect((at.x - zoomed.x) / zoomed.scale).toBeCloseTo(200)
    expect((at.y - zoomed.y) / zoomed.scale).toBeCloseTo(-100)
    const more = zoomAt(zoomed, 4, at, stage)
    expect((at.x - more.x) / more.scale).toBeCloseTo(200)
  })

  it('stays between fit and 8×, and never pans the page out of view', () => {
    expect(zoomAt(FIT, 20, { x: 0, y: 0 }, stage).scale).toBe(8)
    expect(zoomAt(FIT, 0.2, { x: 0, y: 0 }, stage)).toEqual(FIT)
    expect(clampView({ scale: 2, x: 5000, y: -5000 }, stage)).toEqual({ scale: 2, x: 400, y: -300 })
    // Zooming back out to fit recentres.
    expect(zoomAt({ scale: 3, x: 300, y: 200 }, 1, { x: 0, y: 0 }, stage)).toEqual(FIT)
  })

  it('steps through the zoom levels', () => {
    expect(stepFrom(1, 1)).toBe(1.5)
    expect(stepFrom(1.7, 1)).toBe(2)
    expect(stepFrom(1.7, -1)).toBe(1.5)
    expect(stepFrom(1, -1)).toBe(1)
    expect(stepFrom(8, 1)).toBe(8)
  })
})
