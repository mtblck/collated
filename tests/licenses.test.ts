// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LICENSE_FILES } from '../licenses'

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
})
