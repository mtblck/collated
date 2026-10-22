import { describe, expect, it } from 'vitest'
import { fixture } from '../../tests/helpers'
import { cleanContent, concat, namesIn } from './pdfContent'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const clean = (s: string | Uint8Array) =>
  dec(cleanContent(typeof s === 'string' ? enc(s) : s).bytes)

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
  it('copies ordinary content byte for byte', () => {
    const content = enc('q 1 0 0 1 0 0 cm /OC /L BDC (a \\) EI) Tj EMC <</MCID 1>> BDC EMC Q')
    expect(cleanContent(content).bytes).toBe(content)
  })

  it('counts the graphics states and sections the content leaves open', () => {
    expect(cleanContent(enc('q q (Q) Tj /P BMC /OC /A BDC q Q'))).toMatchObject({
      openStates: 2,
      openSections: 2,
    })
  })

  it('leaves inline images that are not JPEGs alone, even with "EMC" or "EI" in their data', () => {
    const content = enc('BI /W 2 /H 1 /BPC 8 /CS /G ID EMC\nEI\x01\x02 EI Q')
    expect(cleanContent(content).bytes).toBe(content)
    expect(cleanContent(content).openSections).toBe(0)
  })

  it('finds an inline image’s end as pdf.js does: "xEI" counts, "EI/" does not', () => {
    expect(namesIn(enc('BI /W 1 /H 1 /BPC 8 /CS /G ID\nxEI Q /Im1 Do'))).toContain('Im1')
    expect(namesIn(enc('BI /W 1 /H 1 /BPC 8 /CS /G ID \x00 EI/ junk\nEI\n/Im2 Do'))).toContain(
      'Im2',
    )
  })

  it('strips inline JPEG metadata and anything stored after the image', () => {
    const out = clean(
      concat([
        enc('q BI /W 240 /H 160 /CS /RGB /BPC 8 /F /DCT ID\r\n'),
        tagged('FIRST-EXIF'),
        tagged('APPENDED-SECRET'),
        enc(' EI Q'),
      ]),
    )
    expect(out).not.toContain('FIRST-EXIF')
    expect(out).not.toContain('APPENDED-SECRET')
    expect(out).toMatch(/^q BI .* ID\r\n\xff\xd8/s)
    expect(out).toMatch(/\xff\xd9\nEI Q$/)
  })

  it('reads an inline image’s filter as a key, not a value', () => {
    const content = concat([
      enc('BI /W 240 /H 160 /CS /F /BPC 8 /F /DCT ID '),
      tagged('VALUE-F-EXIF'),
      enc(' EI'),
    ])
    expect(clean(content)).not.toContain('VALUE-F-EXIF')
  })

  it('removes inline JPEGs it cannot clean: wrapped in another filter, broken', () => {
    const hex = Array.from(tagged('HEX-EXIF'), (b) => b.toString(16).padStart(2, '0')).join('')
    expect(clean(`q BI /W 1 /H 1 /F [/AHx /DCT] ID ${hex}> EI Q`)).toBe('q  Q')
    const escaped = concat([enc('BI /W 1 /H 1 /F /D#43T ID '), tagged('ESC-EXIF'), enc(' EI')])
    expect(clean(escaped)).not.toContain('ESC-EXIF')
    expect(clean('BI /W 1 /H 1 /F /DCT ID notajpeg EXIF-HERE EI 0 g')).toBe(' 0 g')
  })

  it('does not lose its place on "ID" run into the data, and drops what nothing draws', () => {
    expect(clean('BI /W 1 /H 1 /F /AHx ID00> EI 0 g')).toBe('BI /W 1 /H 1 /F /AHx ID00> EI 0 g')
    expect(clean('0 g BI /W 1 /H 1 /F')).toBe('0 g ')
    expect(clean('0 g (unterminated SECRET')).toBe('0 g ')
  })
})

describe('namesIn', () => {
  it('ignores names inside strings and inline image data, but not inline images’ colour spaces', () => {
    const names = namesIn(enc('(see p2/ImB) Tj BI /W 1 /H 1 /CS /CS0 ID /Fake EI'))
    expect(names).not.toContain('ImB')
    expect(names).not.toContain('Fake')
    expect(names).toContain('CS0')
  })
})
