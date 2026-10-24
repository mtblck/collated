import { describe, expect, it } from 'vitest'
import { MIN_CONFIDENCE, describeAutoRotate, uprightTurns } from './orientation'

describe('uprightTurns', () => {
  it.each([
    [0, 0],
    [90, 1],
    [180, 2],
    [270, 3],
  ] as const)('turns a page that needs %i° clockwise by %i quarter turns', (degrees, turns) => {
    expect(uprightTurns({ degrees, confidence: 20 })).toBe(turns)
  })

  it('leaves pages with no answer or a weak one alone', () => {
    expect(uprightTurns(null)).toBeNull()
    expect(uprightTurns({ degrees: 180, confidence: MIN_CONFIDENCE - 0.1 })).toBeNull()
    expect(uprightTurns({ degrees: 180, confidence: Number.NaN })).toBeNull()
    expect(uprightTurns({ degrees: 45, confidence: 20 })).toBeNull()
  })
})

describe('describeAutoRotate', () => {
  it('names the pages it turned', () => {
    expect(describeAutoRotate({ turned: [2], upright: 3, unclear: 0 })).toBe(
      'Turned page 2 the right way up.',
    )
    expect(describeAutoRotate({ turned: [2, 5, 7], upright: 1, unclear: 0 })).toBe(
      'Turned pages 2, 5 and 7 the right way up.',
    )
    const many = Array.from({ length: 13 }, (_, i) => i + 1)
    expect(describeAutoRotate({ turned: many, upright: 0, unclear: 0 })).toBe(
      'Turned 13 pages the right way up.',
    )
  })

  it('says which pages had too little text', () => {
    expect(describeAutoRotate({ turned: [1], upright: 0, unclear: 1 })).toBe(
      'Turned page 1 the right way up. 1 page had too little text to tell and was left as it is.',
    )
    expect(describeAutoRotate({ turned: [], upright: 2, unclear: 3 })).toBe(
      'No pages needed turning. 3 pages had too little text to tell and were left as they are.',
    )
    expect(describeAutoRotate({ turned: [], upright: 0, unclear: 2 })).toBe(
      '2 pages had too little text to tell and were left as they are.',
    )
  })

  it('speaks of one page as the page', () => {
    expect(describeAutoRotate({ turned: [4], upright: 0, unclear: 0 })).toBe(
      'Turned the page the right way up.',
    )
    expect(describeAutoRotate({ turned: [], upright: 1, unclear: 0 })).toBe(
      'The page is already the right way up.',
    )
    expect(describeAutoRotate({ turned: [], upright: 0, unclear: 1 })).toMatch(
      /^There isn’t enough text on the page/,
    )
    expect(describeAutoRotate({ turned: [], upright: 4, unclear: 0 })).toBe(
      'All 4 pages are already the right way up.',
    )
  })
})
