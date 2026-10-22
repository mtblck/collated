import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { cleanContent, concat } from './pdfContent'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const hiddenNames =
  (...names: string[]) =>
  (name: string) =>
    names.includes(name)

/** A JPEG with `tag` in an EXIF segment. */
const tagged = (tag: string) => {
  const base = fixture('quad-landscape.jpg')
  const body = enc(`Exif\0\0${tag}`)
  const app1 = new Uint8Array([
    0xff,
    0xe1,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
    ...body,
  ])
  return concat([base.subarray(0, 2), app1, base.subarray(2)])
}

describe('cleanContent', () => {
  it('removes hidden marked-content sections whole, nested ones included', () => {
    const content = enc(
      '0 g /OC /Secret BDC (EMC in a string) Tj /Span <</MCID 1>> BDC 1 0 0 1 0 0 cm EMC 9 9 m EMC 1 g /OC /Shown BDC 5 5 m EMC',
    )
    const { bytes } = cleanContent(content, hiddenNames('Secret'))
    expect(dec(bytes)).toBe('0 g  1 g /OC /Shown BDC 5 5 m EMC')
  })

  it('removes a hidden section left open to the end, and only /OC sections', () => {
    expect(dec(cleanContent(enc('1 g /OC /Secret BDC 9 9 m'), hiddenNames('Secret')).bytes)).toBe(
      '1 g ',
    )
    const other = enc('/Artifact /Secret BDC 9 9 m EMC')
    expect(cleanContent(other, hiddenNames('Secret')).bytes).toBe(other)
  })

  it('counts the graphics states and sections the content leaves open', () => {
    const result = cleanContent(enc('q q (Q) Tj /P BMC /OC /A BDC q Q'), () => false)
    expect(result).toMatchObject({ openStates: 2, openSections: 2 })
  })

  it('leaves inline images that are not JPEGs alone, even with "EMC" in their data', () => {
    const content = enc('/OC /Shown BDC BI /W 2 /H 1 /BPC 8 /CS /G ID \x45MC\n EI EMC')
    const result = cleanContent(content, () => false)
    expect(result.bytes).toBe(content)
    expect(result.openSections).toBe(0)
  })

  it('strips inline JPEG metadata and anything stored after the image', () => {
    const content = concat([
      enc('q BI /W 240 /H 160 /CS /RGB /BPC 8 /F /DCT ID\r\n'),
      tagged('FIRST-EXIF'),
      tagged('APPENDED-SECRET'),
      enc(' EI Q'),
    ])
    const out = dec(cleanContent(content, () => false).bytes)
    expect(out).not.toContain('FIRST-EXIF')
    expect(out).not.toContain('APPENDED-SECRET')
    expect(out).toMatch(/^q BI .* ID\r\n\xff\xd8/s)
    expect(out).toMatch(/\xff\xd9\nEI Q$/)
  })

  it('removes inline JPEGs it cannot clean: wrapped in another filter, escaped names, broken', () => {
    const hex = Array.from(tagged('HEX-EXIF'), (b) => b.toString(16).padStart(2, '0')).join('')
    const wrapped = enc(`q BI /W 1 /H 1 /F [/AHx /DCT] ID ${hex}> EI Q`)
    expect(dec(cleanContent(wrapped, () => false).bytes)).toBe('q  Q')
    const escaped = concat([enc('BI /W 1 /H 1 /F /D#43T ID '), tagged('ESC-EXIF'), enc(' EI')])
    expect(dec(cleanContent(escaped, () => false).bytes)).not.toContain('ESC-EXIF')
    const broken = enc('BI /W 1 /H 1 /F /DCT ID notajpeg EXIF-HERE EI 0 g')
    expect(dec(cleanContent(broken, () => false).bytes)).toBe(' 0 g')
  })
})
