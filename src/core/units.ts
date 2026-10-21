import type { Unit } from './model'

export const PT_PER_IN = 72
export const MM_PER_IN = 25.4

export const toPoints = (value: number, unit: Unit): number =>
  unit === 'in' ? value * PT_PER_IN : (value / MM_PER_IN) * PT_PER_IN

export const fromPoints = (points: number, unit: Unit): number =>
  unit === 'in' ? points / PT_PER_IN : (points / PT_PER_IN) * MM_PER_IN

/** Rounds for display: whole millimetres to 0.1, inches to 0.01. */
export const roundForUnit = (value: number, unit: Unit): number => {
  const step = unit === 'in' ? 100 : 10
  return Math.round(value * step) / step
}

export const formatLength = (points: number, unit: Unit): string =>
  `${roundForUnit(fromPoints(points, unit), unit)} ${unit}`

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
