// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { asset, fixture, page, settings } from '../../tests/helpers'
import { FIT_STEPS, QUALITY_PRESETS, buildWithin, estimateBytes, targetPixels } from './compression'
import { buildPdf, imageJob } from './pdf'

describe('targetPixels', () => {
  it('caps the printed resolution and never upscales', () => {
    // 3000 px drawn 8 in wide is 375 dpi; at 200 dpi it should be 1600 px.
    const big = asset('a', { width: 3000, height: 2000 })
    expect(targetPixels(big, 8 * 72, QUALITY_PRESETS.balanced)).toEqual({
      width: 1600,
      height: 1067,
    })
    // 600 px across 8 in is 75 dpi: already under every cap, left alone.
    const small = asset('b', { width: 600, height: 400 })
    expect(targetPixels(small, 8 * 72, QUALITY_PRESETS.small)).toEqual({ width: 600, height: 400 })
    expect(targetPixels(big, 8 * 72, null)).toEqual({ width: 3000, height: 2000 })
  })
})

describe('imageJob', () => {
  it('leaves untouched images and PDF pages alone', () => {
    expect(imageJob(asset('a'), 'original', 500, null)).toBeNull()
    expect(imageJob(asset('p', { format: 'pdf' }), 'bw', 500, QUALITY_PRESETS.small)).toBeNull()
  })

  it('keeps B&W lossless and compresses everything else as JPEG', () => {
    const a = asset('a', { width: 3000, height: 2000 })
    expect(imageJob(a, 'bw', 576, QUALITY_PRESETS.small)).toMatchObject({
      format: 'png',
      width: 1200,
    })
    expect(imageJob(a, 'original', 576, QUALITY_PRESETS.small)).toMatchObject({
      format: 'jpeg',
      quality: 0.7,
      width: 1200,
    })
    expect(imageJob(a, 'grey', 576, null)).toMatchObject({
      format: 'jpeg',
      quality: 0.9,
      width: 3000,
    })
  })
})

describe('buildPdf with compression', () => {
  const jpeg = fixture('quad-landscape.jpg')
  const meta = asset('a', { width: 240, height: 160, byteLength: jpeg.byteLength })

  it('keeps the original when compressing would make an image bigger', async () => {
    const out = await buildPdf(
      { settings: settings({ quality: 'small' }), pages: [page('p', 'a')], assets: { a: meta } },
      {
        getBytes: () => jpeg,
        // A "compressed" result larger than the original.
        processImage: () => Promise.resolve(new Uint8Array([...jpeg, ...jpeg])),
      },
    )
    expect(Buffer.from(out).includes(Buffer.from(jpeg))).toBe(true)
  })

  it('uses the compressed image when it is smaller', async () => {
    const smaller = fixture('quad-exif3.jpg')
    let job: unknown
    const out = await buildPdf(
      { settings: settings({ quality: 'small' }), pages: [page('p', 'a')], assets: { a: meta } },
      {
        getBytes: () => new Uint8Array([...jpeg, ...new Uint8Array(5000)]),
        processImage: (_bytes, j) => {
          job = j
          return Promise.resolve(smaller)
        },
      },
    )
    expect(job).toMatchObject({ format: 'jpeg', quality: 0.7 })
    expect(Buffer.from(out).includes(Buffer.from(smaller))).toBe(true)
  })
})

describe('buildWithin', () => {
  const sized = (bytes: number) => new Uint8Array(bytes)

  it('builds once when there is no limit', async () => {
    const tried: (number | null)[] = []
    const result = await buildWithin(
      (c) => {
        tried.push(c?.dpi ?? null)
        return Promise.resolve(sized(5_000_000))
      },
      null,
      null,
    )
    expect(tried).toEqual([null])
    expect(result.fits).toBe(true)
  })

  it('steps down from the chosen quality until the file fits', async () => {
    const sizes: Record<string, number> = { original: 9e6, '300': 6e6, '200': 4e6, '150': 2e6 }
    const tried: string[] = []
    const result = await buildWithin(
      (c) => {
        const key = c ? String(c.dpi) : 'original'
        tried.push(key)
        return Promise.resolve(sized(sizes[key] ?? 1e6))
      },
      null,
      3e6,
    )
    expect(tried).toEqual(['original', '300', '200', '150'])
    expect(result.compression?.dpi).toBe(150)
    expect(result.fits).toBe(true)
  })

  it('starts below the chosen quality, and returns the smallest try if nothing fits', async () => {
    const tried: number[] = []
    const result = await buildWithin(
      (c) => {
        tried.push(c?.dpi ?? 0)
        return Promise.resolve(sized(c ? c.dpi * 10_000 : 1e7))
      },
      QUALITY_PRESETS.balanced,
      1000,
    )
    expect(tried).toEqual([200, ...FIT_STEPS.filter((s) => s.dpi < 200).map((s) => s.dpi)])
    expect(result.fits).toBe(false)
    expect(result.compression?.dpi).toBe(96)
  })
})

describe('estimateBytes', () => {
  it('counts originals as stored, a shared PDF once, and shrinks with compression', () => {
    const photo = asset('a', { width: 4000, height: 3000, byteLength: 4_000_000 })
    const pdfA = asset('p1', { format: 'pdf', bytesId: 'f', byteLength: 100_000 })
    const pdfB = asset('p2', { format: 'pdf', bytesId: 'f', byteLength: 100_000 })
    const items = [
      { asset: photo, drawnWidthPt: 792 },
      { asset: pdfA, drawnWidthPt: 612 },
      { asset: pdfB, drawnWidthPt: 612 },
    ]
    const original = estimateBytes(items, null)
    expect(original).toBe(4_000_000 + 100_000 + 2_000)
    const small = estimateBytes(items, QUALITY_PRESETS.small)
    expect(small).toBeLessThan(original / 4)
    expect(small).toBeGreaterThan(100_000)
  })
})
