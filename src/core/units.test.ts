import { describe, expect, it } from 'vitest'
import { formatBytes, formatLength, fromPoints, roundForUnit, toPoints } from './units'

describe('units', () => {
  it('converts inches and millimetres to points and back', () => {
    expect(toPoints(1, 'in')).toBe(72)
    expect(toPoints(25.4, 'mm')).toBeCloseTo(72)
    expect(fromPoints(toPoints(210, 'mm'), 'mm')).toBeCloseTo(210)
    expect(fromPoints(612, 'in')).toBe(8.5)
  })

  it('rounds to a sensible precision per unit', () => {
    expect(roundForUnit(209.99999, 'mm')).toBe(210)
    expect(roundForUnit(8.4999, 'in')).toBe(8.5)
    expect(formatLength(612, 'in')).toBe('8.5 in')
  })

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})
