import { describe, expect, it } from 'vitest'
import { imageFilename } from './filename'
import { imageCompression, imagesWord, isImageFormat, pagePixels } from './imageExport'

describe('pages as images (#117)', () => {
  it('draws a page at the chosen resolution', () => {
    // A4 at 300 dpi: 2480 × 3508.
    expect(pagePixels(595.28, 841.89, 300, 16_000_000)).toMatchObject({
      width: 2480,
      height: 3508,
    })
    expect(pagePixels(612, 792, 150, 16_000_000)).toEqual({
      width: 1275,
      height: 1650,
      scale: 150 / 72,
    })
  })

  it('scales a page down to the canvas limit, keeping its shape', () => {
    // A3 at 300 dpi would be 17.4 megapixels.
    const { width, height } = pagePixels(841.89, 1190.55, 300, 16_000_000)
    expect(width * height).toBeLessThanOrEqual(16_000_000)
    expect(width / height).toBeCloseTo(841.89 / 1190.55, 3)
    expect(pagePixels(0.1, 0.1, 72, 100)).toMatchObject({ width: 1, height: 1 })
  })

  it('takes the resolution from the quality, 300 dpi for Original', () => {
    expect(imageCompression('original')).toEqual({ dpi: 300, quality: 0.92 })
    expect(imageCompression('balanced')).toMatchObject({ dpi: 200, quality: 0.8 })
    expect(imageCompression('small')).toMatchObject({ dpi: 150 })
  })

  it('names and counts the images', () => {
    expect(isImageFormat('pdf')).toBe(false)
    expect(isImageFormat('png')).toBe(true)
    expect(imagesWord(1, 'png')).toBe('1 PNG')
    expect(imagesWord(3, 'jpg')).toBe('3 JPGs')
    expect(imageFilename('Lease 2026', 0, 1, 'jpg')).toBe('Lease-2026.jpg')
    expect(imageFilename('Lease 2026', 8, 12, 'png')).toBe('Lease-2026-page-09.png')
    expect(imageFilename('', 0, 2, 'jpg', new Date(2026, 10, 5))).toBe(
      'scans-2026-11-05-page-1.jpg',
    )
  })
})
