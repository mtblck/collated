// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createWorker, OEM, type Worker } from 'tesseract.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { uprightTurns } from '../core/orientation'

/**
 * The real engine and data the app self-hosts, on pages turned each way: the
 * mapping from Tesseract's answer to quarter turns is easy to get backwards.
 */
const FIXTURES = join(import.meta.dirname, '../../tests/fixtures')
const OSD_DATA = dirname(
  createRequire(import.meta.url).resolve(
    '@tesseract.js-data/osd/4.0.0_best_int/osd.traineddata.gz',
  ),
)

describe('orientation detection with Tesseract', () => {
  let worker: Worker
  beforeAll(async () => {
    worker = await createWorker('osd', OEM.TESSERACT_ONLY, {
      langPath: OSD_DATA,
      legacyCore: true,
      legacyLang: true,
      gzip: true,
      cacheMethod: 'none',
    })
    await worker.setParameters({ debug_file: '/dev/null' })
  }, 60_000)
  afterAll(async () => {
    await worker.terminate()
  })

  const detect = async (name: string) => {
    const { data } = await worker.detect(readFileSync(join(FIXTURES, name)))
    const { orientation_degrees: degrees, orientation_confidence: confidence } = data
    return uprightTurns(degrees === null || confidence === null ? null : { degrees, confidence })
  }

  // Turned clockwise by `degrees`, so it takes the rest of a full turn back.
  it.each([
    [0, 0],
    [90, 3],
    [180, 2],
    [270, 1],
  ] as const)('a letter turned %i° takes %i quarter turns', async (degrees, turns) => {
    expect(await detect(`text-letter-cw${String(degrees)}.png`)).toBe(turns)
  })

  it('reads four short lines on a sideways photo', async () => {
    expect(await detect('text-page-sideways.jpg')).toBe(1)
  })

  it.each(['quad-portrait.jpg', 'paper-dark-table.jpg'])(
    'leaves %s, with no text, alone',
    async (name) => {
      expect(await detect(name)).toBeNull()
    },
  )
})
