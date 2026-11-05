import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { readPngInfo } from './imageInfo'
import { encodePng1, readGreyPng } from './png'

describe('1-bit PNGs (#113)', () => {
  it('pack eight pixels a byte, black as 0, and read back as greyscale', () => {
    // 10 × 2: a black first and last pixel on row 0, all black on row 1.
    const pixels = Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 1, 0, ...Array<number>(10).fill(0)])
    const png = encodePng1(pixels, 10, 2)
    expect(readPngInfo(png)).toEqual({
      width: 10,
      height: 2,
      bitDepth: 1,
      colorType: 0,
      interlaced: false,
    })
    const grey = readGreyPng(png)
    expect(grey).toMatchObject({ width: 10, height: 2, bitDepth: 1 })
    // Each row: filter byte 0, then two bytes of pixels.
    expect(Array.from(unzlibSync(grey?.data ?? new Uint8Array()))).toEqual([
      0, 0b01111111, 0b10000000, 0, 0, 0,
    ])
  })

  it('leave colour PNGs to the general path', () => {
    expect(readGreyPng(fixture('quad-landscape.png'))).toBeNull()
    expect(readGreyPng(fixture('interlaced-header.png'))).toBeNull()
    expect(readGreyPng(fixture('quad-landscape.jpg'))).toBeNull()
  })
})
