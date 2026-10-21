// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_PIXELS } from '../core/limits'
import { ImportError, assertImportPixels, tooManyPixels } from './errors'

describe('import pixel cap', () => {
  it('accepts up to the cap and refuses past it with a readable reason', () => {
    expect(tooManyPixels(10_000, MAX_IMPORT_PIXELS / 10_000)).toBeNull()
    expect(() => {
      assertImportPixels(8064, 6048) // a 48 MP phone photo
    }).not.toThrow()
    const error = tooManyPixels(20_000, 20_000)
    expect(error).toBeInstanceOf(ImportError)
    expect(error?.message).toBe(
      'This image is too large (20,000 × 20,000 pixels, 400 megapixels). Images up to 100 megapixels can be added; scale it down and try again.',
    )
    expect(() => {
      assertImportPixels(20_000, 20_000)
    }).toThrow(ImportError)
  })
})
