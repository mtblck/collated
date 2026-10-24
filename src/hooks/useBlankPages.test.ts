import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { asset, page } from '../../tests/helpers'
import { blankPage, type Asset, type Slot } from '../core/model'
import { useBlankPages } from './useBlankPages'

const assets = Object.fromEntries(
  ['text', 'empty1', 'empty2'].map((id) => [id, asset(id)]),
) as Record<string, Asset>
const detect = (a: Asset) => Promise.resolve(a.id.startsWith('empty'))
const slot = (assetId: string): Slot => {
  const { id: _id, ...rest } = page('x', assetId)
  return rest
}

describe('useBlankPages', () => {
  it('flags a combined page only when every picture on it looks blank (#76)', async () => {
    const pages = [
      page('p1', 'empty1'),
      page('p2', 'text'),
      page('both-empty', 'empty1', {
        sheet: { kind: 'two', slots: [slot('empty1'), slot('empty2')] },
      }),
      page('one-empty', 'empty2', {
        sheet: { kind: 'two', slots: [slot('empty2'), slot('text')] },
      }),
    ]
    const { result } = renderHook(() => useBlankPages(pages, assets, detect))
    await waitFor(() => {
      expect(result.current.checking).toBe(false)
    })
    expect(result.current.blankIds).toEqual(['p1', 'both-empty'])
  })

  it('never flags a blank page inserted on purpose (#80)', async () => {
    const pages = [page('p1', 'text'), blankPage('inserted')]
    const { result } = renderHook(() => useBlankPages(pages, assets, detect))
    await waitFor(() => {
      expect(result.current.checking).toBe(false)
    })
    expect(result.current.blankIds).toEqual([])
  })
})
