import { useEffect, useMemo, useRef, useState } from 'react'
import type { Asset, Page } from '../core/model'

/** What blankness depends on: the image, and the paper cropped out of it. */
const keyOf = (page: Pick<Page, 'assetId' | 'corners'>) =>
  `${page.assetId}:${JSON.stringify(page.corners)}`

/**
 * Which pages look blank (#68). Each page is checked once, in the
 * background after it arrives (and again if its crop changes), one at a time
 * so a long scan doesn't stall the page. Duplicates share their original's
 * answer. A page whose check fails is simply not flagged. Nothing is ever
 * removed here: that's the person's call.
 */
export const useBlankPages = (
  pages: Page[],
  assets: Record<string, Asset>,
  detect: (asset: Asset, page: Page) => Promise<boolean | null>,
) => {
  const [found, setFound] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const queued = useRef(new Set<string>())

  useEffect(() => {
    const todo = new Map<string, { asset: Asset; page: Page }>()
    for (const page of pages) {
      const key = keyOf(page)
      const asset = assets[page.assetId]
      if (asset && !found.has(key) && !queued.current.has(key)) todo.set(key, { asset, page })
    }
    if (todo.size === 0) return
    for (const key of todo.keys()) queued.current.add(key)
    void (async () => {
      for (const [key, { asset, page }] of todo) {
        let blank = false
        try {
          blank = (await detect(asset, page)) ?? false
        } catch {
          /* not flagged */
        }
        queued.current.delete(key)
        setFound((map) => new Map(map).set(key, blank))
        // Let the page paint between pages of a long document.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    })()
  }, [assets, detect, found, pages])

  const blankIds = useMemo(
    () => pages.flatMap((p) => (found.get(keyOf(p)) ? [p.id] : [])),
    [found, pages],
  )
  /** Some page hasn't had its answer yet. */
  const checking = pages.some((p) => p.assetId in assets && !found.has(keyOf(p)))
  return { blankIds, checking }
}
