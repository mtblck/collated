import { describe, expect, it } from 'vitest'
import { edgeMidpoint, fromView, moveEdge, quadFromView, quadToView, toView } from './cropFrame'
import { FULL_IMAGE, type Quad } from './perspective'

const crop: Quad = [
  { x: 0.1, y: 0.2 },
  { x: 0.8, y: 0.15 },
  { x: 0.9, y: 0.9 },
  { x: 0.05, y: 0.85 },
]

const close = (a: Quad, b: Quad) => {
  a.forEach((p, i) => {
    expect(p.x).toBeCloseTo(b[i]?.x ?? NaN, 9)
    expect(p.y).toBeCloseTo(b[i]?.y ?? NaN, 9)
  })
}

describe('crop view frame', () => {
  it('turns points as the page shows them', () => {
    // Upright top-left, turned clockwise once, is at the top right.
    expect(toView({ x: 0, y: 0 }, 1)).toEqual({ x: 1, y: 0 })
    expect(toView({ x: 0.25, y: 0.1 }, 1)).toEqual({ x: 0.9, y: 0.25 })
    expect(toView({ x: 0.25, y: 0.1 }, 2)).toEqual({ x: 0.75, y: 0.9 })
    expect(toView({ x: 0.25, y: 0.1 }, 3)).toEqual({ x: 0.1, y: 0.75 })
    for (const turns of [0, 1, 2, 3, 5, -1]) {
      const back = fromView(toView({ x: 0.3, y: 0.7 }, turns), turns)
      expect(back.x).toBeCloseTo(0.3, 12)
      expect(back.y).toBeCloseTo(0.7, 12)
    }
  })

  it.each([0, 1, 2, 3])('round-trips corners and keeps screen order (%i turns)', (turns) => {
    close(quadFromView(quadToView(crop, turns), turns), crop)
    const view = quadToView(crop, turns)
    // Screen order: the first corner is the one nearest the view's top left.
    const nearest = view.reduce(
      (best, p, i) => (p.x + p.y < (view[best]?.x ?? 9) + (view[best]?.y ?? 9) ? i : best),
      0,
    )
    expect(nearest).toBe(0)
    // The whole image stays the whole image, in order.
    close(quadToView(FULL_IMAGE, turns), FULL_IMAGE)
  })
})

describe('moving an edge', () => {
  const square: Quad = [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.8, y: 0.8 },
    { x: 0.2, y: 0.8 },
  ]

  it('moves both corners straight across, ignoring movement along the edge', () => {
    const moved = moveEdge(square, 0, { x: 0.3, y: 0.1 }, 400, 300) // top edge, pulled down-right
    close(moved, [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.3 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 },
    ])
    expect(moveEdge(square, 0, { x: 0.2, y: 0 }, 400, 300)).toBe(square)
    expect(edgeMidpoint(square, 1)).toEqual({ x: 0.8, y: 0.5 })
  })

  it('stops at the image edge without tilting', () => {
    const moved = moveEdge(square, 1, { x: 0.5, y: 0 }, 400, 300) // right edge, far out
    expect(moved[1]).toEqual({ x: 1, y: 0.2 })
    expect(moved[2]).toEqual({ x: 1, y: 0.8 })
  })

  it('keeps a slanted edge parallel, measured in pixels', () => {
    const slanted: Quad = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ]
    const moved = moveEdge(slanted, 0, { x: 0, y: 0.05 }, 1000, 500)
    const before = { x: (0.9 - 0.1) * 1000, y: (0.1 - 0.2) * 500 }
    const after = {
      x: (moved[1].x - moved[0].x) * 1000,
      y: (moved[1].y - moved[0].y) * 500,
    }
    expect(after.x * before.y - after.y * before.x).toBeCloseTo(0, 6)
    expect(moved[2]).toEqual(slanted[2])
  })
})
