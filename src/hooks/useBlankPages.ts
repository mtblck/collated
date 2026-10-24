import { useEffect, useMemo, useRef, useState } from 'react'
import { picturesOf, type Asset, type Page, type Slot } from '../core/model'

/** What blankness depends on: the image, and the paper cropped out of it. */
const keyOf = (slot: Pick<Slot, 'assetId' | 'corners'>) =>
  `${slot.assetId}:${JSON.stringify(slot.corners)}`

/**
 * Which pages look blank (#68). Each page is checked once, in the
 * background after it arrives (and again if its crop changes), one at a time
 * so a long scan doesn't stall the page. Duplicates share their original's
 * answer. A combined page (#76) is checked picture by picture and looks
 * blank only when every picture on it does. A picture whose check fails is
 * simply not flagged, and so is a blank page inserted on purpose (#80).
 * Nothing is ever
 * removed here: that's the person's call.
 */
export const useBlankPages = (
  pages: Page[],
  assets: Record<string, Asset>,
  detect: (asset: Asset, picture: Slot) => Promise<boolean | null>,
) => {
  const [found, setFound] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const queued = useRef(new Set<string>())

  useEffect(() => {
    const todo = new Map<string, { asset: Asset; picture: Slot }>()
    for (const picture of pages.flatMap(picturesOf)) {
      const key = keyOf(picture)
      const asset = assets[picture.assetId]
      if (asset && !found.has(key) && !queued.current.has(key)) todo.set(key, { asset, picture })
    }
    if (todo.size === 0) return
    for (const key of todo.keys()) queued.current.add(key)
    void (async () => {
      for (const [key, { asset, picture }] of todo) {
        let blank = false
        try {
          blank = (await detect(asset, picture)) ?? false
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
    () =>
      pages.flatMap((p) =>
        // A blank page that was inserted (#80) is blank on purpose.
        !p.blank && picturesOf(p).every((slot) => found.get(keyOf(slot))) ? [p.id] : [],
      ),
    [found, pages],
  )
  /** Some page hasn't had its answer yet. */
  const checking = pages
    .flatMap(picturesOf)
    .some((slot) => slot.assetId in assets && !found.has(keyOf(slot)))
  return { blankIds, checking }
}
