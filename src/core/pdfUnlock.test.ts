// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unlockedCopy } from './pdfUnlock'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dirname, '../../tests/fixtures', name)))

/** pdftoppm's PNG of each page, at a low resolution. */
const raster = (bytes: Uint8Array) => {
  const work = mkdtempSync(join(tmpdir(), 'unlock-'))
  try {
    writeFileSync(join(work, 'in.pdf'), bytes)
    execFileSync('pdftoppm', ['-r', '20', '-png', join(work, 'in.pdf'), join(work, 'p')])
    return [1, 2, 3].map((n) => readFileSync(join(work, `p-${String(n)}.png`)).toString('base64'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

describe('unlockedCopy', () => {
  it('opens a PDF with its password and writes it without one, pages unchanged', async () => {
    const copy = await unlockedCopy(fixture('quad-password.pdf'), 'user-secret')
    const info = execFileSync('pdfinfo', ['-'], { input: copy }).toString()
    expect(info).toMatch(/Encrypted:\s+no/)
    expect(info).toMatch(/Pages:\s+3/)
    expect(raster(copy)).toEqual(raster(fixture('quad-3pages.pdf')))
  })

  it('refuses a wrong password, and none', async () => {
    await expect(unlockedCopy(fixture('quad-password.pdf'), 'nope')).rejects.toThrow()
    await expect(unlockedCopy(fixture('quad-password.pdf'), '')).rejects.toThrow()
  })
})
