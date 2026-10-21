// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/*
 * Raster, text-layer, encryption and sanitising tests skip when their tools
 * are missing, so a laptop without poppler still runs the rest. In CI a skip
 * would hide a regression, so there the tools must be present.
 */
const tools: [string, string[]][] = [
  ['pdftoppm', ['-v']],
  ['pdftotext', ['-v']],
  ['pdfimages', ['-v']],
  ['qpdf', ['--version']],
  ['python3', ['-c', 'import PIL']],
]

describe.runIf(process.env.CI)('CI has every tool the tests use', () => {
  it.each(tools)('%s', (tool, args) => {
    expect(() => execFileSync(tool, args, { stdio: 'ignore' })).not.toThrow()
  })
})
