// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { LICENSE_FILES, TESSERACT_CORE_LICENSES } from '../licenses'

describe('shipped licence texts', () => {
  it('resolve to the upstream texts', () => {
    const text = (name: string) => readFileSync(LICENSE_FILES[name] ?? '', 'utf8')
    expect(text('LGPL-3.0-and-GPL-3.0.txt')).toContain('GNU LESSER GENERAL PUBLIC LICENSE')
    expect(text('LGPL-3.0-and-GPL-3.0.txt')).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(text('Apache-2.0.txt')).toContain('Apache License')
    expect(text('idb-keyval-NOTICE.txt')).toContain('Apache License')
    expect(text('tesseract-worker-NOTICES.txt')).toContain('zlib.js')
    expect(text('THIRD-PARTY-NOTICES.md')).toContain('# Third-party notices')
  })

  it('include the C libraries compiled into tesseract.js-core, for the installed version', () => {
    const text = (name: string) =>
      readFileSync(LICENSE_FILES[`tesseract-core/${name}`] ?? '', 'utf8')
    const { version } = createRequire(import.meta.url)('tesseract.js-core/package.json') as {
      version: string
    }
    // Upgrading tesseract.js-core means re-checking its third_party/ commits.
    expect(text('README.md')).toContain(`tesseract.js-core **${version}**`)
    expect(text('leptonica.txt')).toContain('Leptonica')
    expect(text('libtiff.txt')).toContain('Sam Leffler')
    expect(text('libpng.txt')).toContain('PNG Reference Library License')
    expect(text('zlib-README.txt')).toContain('Jean-loup Gailly and Mark Adler')
    expect(text('libjpeg-README.txt')).toContain('Independent JPEG Group')
    expect(text('libwebp.txt')).toContain('Google Inc')
    expect(text('libwebp-PATENTS.txt')).toContain('patent')
    expect(text('giflib.txt')).toContain('Eric S. Raymond')
    expect(text('openlibm.txt')).toContain('OpenLibm')
    // Every vendored file is listed in the README.
    for (const name of TESSERACT_CORE_LICENSES.filter((n) => n !== 'README.md')) {
      expect(text('README.md')).toContain(`\`${name}\``)
    }
  })
})
