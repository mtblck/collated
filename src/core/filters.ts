import type { Filter } from './model'

/**
 * Pixel filters for document pages, on raw RGBA data so the same code runs in
 * the page (preview thumbnails) and in the export worker (full resolution).
 * Pure and in-place: no canvas, no DOM.
 */

/** ITU-R BT.601 luma, as most scanners use. */
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b

const greyscale = (data: Uint8ClampedArray) => {
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
    data[i] = data[i + 1] = data[i + 2] = y
  }
}

/** How far below the local mean a pixel must be to count as ink. */
export const BW_THRESHOLD = 0.15

/**
 * Black and white by adaptive threshold (Bradley–Roth): a pixel is ink when
 * it is clearly darker than the average of its neighbourhood. A global cut
 * fails on phone photos of paper, where one corner can be in shadow; comparing
 * with the local mean follows the lighting. The window is an eighth of the
 * image's width, so a thumbnail and the full-size export threshold alike.
 * An integral image makes every window sum O(1).
 */
const blackAndWhite = (data: Uint8ClampedArray, width: number, height: number) => {
  const grey = new Float64Array(width * height)
  for (let p = 0, i = 0; p < grey.length; p++, i += 4) {
    grey[p] = luma(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
  }
  // integral[(y + 1) * (width + 1) + (x + 1)] = sum of grey over [0..x] × [0..y]
  const stride = width + 1
  const integral = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += grey[y * width + x] ?? 0
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + row
    }
  }
  const half = Math.max(1, Math.floor(width / 16))
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const count = (x1 - x0 + 1) * (y1 - y0 + 1)
      const sum =
        (integral[(y1 + 1) * stride + x1 + 1] ?? 0) -
        (integral[y0 * stride + x1 + 1] ?? 0) -
        (integral[(y1 + 1) * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0)
      const ink = (grey[y * width + x] ?? 0) * count < sum * (1 - BW_THRESHOLD)
      const i = (y * width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = ink ? 0 : 255
    }
  }
}

export const applyFilter = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  filter: Filter,
): void => {
  if (filter === 'grey') greyscale(data)
  else if (filter === 'bw') blackAndWhite(data, width, height)
}

/**
 * How a filtered page is stored: greyscale as JPEG (smooth tones compress
 * well), black and white as PNG (lossless, so text edges stay sharp and the
 * flat white compresses to almost nothing).
 */
export const filterEncoding = (filter: Exclude<Filter, 'original'>) =>
  filter === 'bw'
    ? ({ format: 'png', type: 'image/png' } as const)
    : ({ format: 'jpeg', type: 'image/jpeg', quality: 0.9 } as const)
