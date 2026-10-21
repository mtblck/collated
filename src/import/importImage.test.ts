import { afterEach, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../tests/helpers'
import { ImportError, importImage } from './importImage'

/** A real PNG whose IHDR claims another size (readers don't check the CRC first). */
const pngClaiming = (width: number, height: number) => {
  const bytes = fixture('quad-landscape.png').slice()
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** A real JPEG whose start-of-frame header claims another size. */
const jpegClaiming = (width: number, height: number) => {
  const bytes = fixture('quad-landscape.jpg').slice()
  const view = new DataView(bytes.buffer)
  for (let i = 2; i + 9 < bytes.length; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xc0) {
      view.setUint16(i + 5, height)
      view.setUint16(i + 7, width)
      return bytes
    }
  }
  throw new Error('no SOF0 in fixture')
}

/** The HEIC fixture with every 'ispe' (image size) box claiming another size. */
const heicClaiming = (width: number, height: number) => {
  const bytes = fixture('quad-landscape.heic').slice()
  const view = new DataView(bytes.buffer)
  let found = 0
  for (let i = 4; i + 16 < bytes.length; i++) {
    if (
      bytes[i] === 0x69 &&
      bytes[i + 1] === 0x73 &&
      bytes[i + 2] === 0x70 &&
      bytes[i + 3] === 0x65
    ) {
      view.setUint32(i + 8, width)
      view.setUint32(i + 12, height)
      found++
    }
  }
  if (!found) throw new Error('no ispe in fixture')
  return bytes
}

describe('importImage pixel cap', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each([
    ['PNG', 'png', pngClaiming(20_000, 20_000)],
    ['JPEG', 'jpeg', jpegClaiming(20_000, 20_000)],
    // Safari decodes HEIC itself; this is checked before it does (#26).
    ['HEIC', 'heic', heicClaiming(20_000, 20_000)],
  ] as const)('refuses a %s claiming 400 MP before decoding it', async (_, kind, bytes) => {
    const decode = vi.fn(() => Promise.reject(new Error('should not decode')))
    vi.stubGlobal('createImageBitmap', decode)
    const file = new File([bytes], `huge.${kind}`)
    const imported = importImage(file, 'a', bytes, kind)
    await expect(imported).rejects.toBeInstanceOf(ImportError)
    await expect(imported).rejects.toThrow(/too large \(20,000 × 20,000 pixels/)
    expect(decode).not.toHaveBeenCalled()
  })
})
