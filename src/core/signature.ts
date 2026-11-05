import { inkMask } from './filters'

/**
 * Signatures (#111), pixel side, kept free of the DOM so it's tested in
 * Node: trimming a drawing to its ink, and turning a photo of a signature
 * into ink on a transparent background. The canvases are in
 * lib/signatureCanvas.ts.
 */

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** Alpha at or below this is paper (anti-aliasing fringe), not ink. */
const ALPHA_FLOOR = 8

/**
 * The smallest rectangle holding every visible pixel of an RGBA image, grown
 * by `pad` pixels each side (inside the image); null if nothing shows.
 */
export const inkBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  pad = 0,
): Bounds | null => {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) <= ALPHA_FLOOR) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  if (x1 < 0) return null
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(width - 1, x1 + pad)
  y1 = Math.min(height - 1, y1 + pad)
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/**
 * A photo of a signature as ink on nothing: the B&W filter's ink mask (an
 * adaptive threshold, so uneven light on the paper doesn't turn to ink)
 * decides what is pen; pen pixels keep their colour, darkened a little so a
 * ballpoint reads as ink, and everything else turns transparent. In place.
 */
export const photoToInk = (data: Uint8ClampedArray, width: number, height: number) => {
  const mask = inkMask(data, width, height)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p]) {
      data[i] = Math.round((data[i] ?? 0) * 0.6)
      data[i + 1] = Math.round((data[i + 1] ?? 0) * 0.6)
      data[i + 2] = Math.round((data[i + 2] ?? 0) * 0.6)
      data[i + 3] = 255
    } else {
      data[i + 3] = 0
    }
  }
}

/** Whether a photo held enough ink to be a signature (not blank paper or all dark). */
export const inkShare = (data: Uint8ClampedArray) => {
  let ink = 0
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > ALPHA_FLOOR) ink++
  return data.length ? ink / (data.length / 4) : 0
}

/** Pen colours a signature can be drawn or typed in: black, and the blue of a ballpoint. */
export const INKS = {
  black: '#111111',
  blue: '#1f3a93',
} as const

export type Ink = keyof typeof INKS

/** Longest side of a stored signature, in pixels: sharp at 4 in wide and 300 dpi, still small. */
export const SIGNATURE_MAX_EDGE = 1200

/** A point of a stroke, in the pad's pixels, with the pen's pressure (0–1) where it has one. */
export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

/**
 * The pen width at a point: thinner with a light touch on a pen that knows
 * pressure. Fingers and mice report 0.5 (or 0) always, so they get `base`.
 */
export const penWidth = (base: number, pressure: number) =>
  pressure > 0 && pressure !== 0.5 ? base * (0.55 + pressure * 0.9) : base
