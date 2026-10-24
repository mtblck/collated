// @vitest-environment node
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, ViteDevServer } from 'vite'
import { statSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { OCR_FILES, ocrAssets } from '../ocr-assets'
import { OCR_LANGUAGES } from '../src/core/ocrLanguages'

const BASE = '/'

const middleware = () => {
  let handler: Connect.NextHandleFunction | undefined
  const plugin = ocrAssets(BASE)
  const server = {
    middlewares: {
      use: (fn: Connect.NextHandleFunction) => {
        handler = fn
      },
    },
  } as unknown as ViteDevServer
  ;(plugin.configureServer as (s: ViteDevServer) => void)(server)
  if (!handler) throw new Error('no middleware registered')
  return handler
}

const request = (url: string) => {
  const handle = middleware()
  const next = vi.fn()
  const res = { setHeader: vi.fn(), end: vi.fn() }
  handle({ url } as IncomingMessage, res as unknown as ServerResponse, next)
  return { next, res }
}

describe('OCR assets dev middleware', () => {
  it('serves its own files', () => {
    const { next, res } = request(`${BASE}ocr/worker.min.js`)
    expect(next).not.toHaveBeenCalled()
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/javascript')
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'nope.js'])(
    'passes /ocr/%s on rather than resolving it',
    (name) => {
      const { next, res } = request(`${BASE}ocr/${name}`)
      expect(next).toHaveBeenCalledOnce()
      expect(res.end).not.toHaveBeenCalled()
    },
  )

  it.each(OCR_LANGUAGES)('self-hosts $label data, of the size the picker says', ({ code, mb }) => {
    const file = OCR_FILES[`lang/${code}.traineddata.gz`]
    expect(file).toBeDefined()
    const size = statSync(file ?? '').size / 1e6
    expect(Math.abs(size - mb)).toBeLessThan(0.15)
  })
})
