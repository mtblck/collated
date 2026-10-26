import { afterEach, describe, expect, it, vi } from 'vitest'
import { track } from './track'

afterEach(() => vi.unstubAllGlobals())

function stub(hostname: string) {
  const sendBeacon = vi.fn(() => true)
  vi.stubGlobal('location', { hostname })
  vi.stubGlobal('navigator', { sendBeacon })
  return sendBeacon
}

describe('track', () => {
  it('sends only the project and event name, to its own site', () => {
    const sendBeacon = stub('collatedpdf.com')
    track('exported')
    expect(sendBeacon).toHaveBeenCalledWith(
      '/_mb/events',
      '{"project":"collated","event":"exported"}',
    )
  })

  it('never counts off the live site', () => {
    for (const host of ['localhost', 'collated-git-x-mtblcks-projects.vercel.app']) {
      const sendBeacon = stub(host)
      track('exported')
      expect(sendBeacon).not.toHaveBeenCalled()
    }
  })
})
