import { useEffect, useState } from 'react'
import type { Asset, Page } from '../core/model'
import { assetStore } from '../import/assetStore'
import { previewToBlob } from '../lib/filterCanvas'

/**
 * A page's preview: its thumbnail, cropped (corners) and filtered with the
 * same pixel code the export uses at full size — so what you see is what the
 * PDF gets. Made once per asset, filter and crop; cached for the session and
 * released with the document's other thumbnails.
 */
const cache = new Map<string, Promise<string>>()
/** Bumped by `forgetPageThumbs`, so a preview still being made is dropped. */
let generation = 0

/** Forgets every preview (Start over; `assetStore.clear` revokes their URLs). */
export const forgetPageThumbs = () => {
  cache.clear()
  generation += 1
}

type Look = Pick<Page, 'filter' | 'corners'>

const keyOf = (asset: Pick<Asset, 'id'>, look: Look) =>
  `${asset.id}:${look.filter}:${JSON.stringify(look.corners)}`

const previewOf = (asset: Pick<Asset, 'id' | 'thumbUrl'>, look: Look) => {
  const key = keyOf(asset, look)
  const cached = cache.get(key)
  if (cached) return cached
  const source = assetStore.thumbBlob(asset.thumbUrl)
  const started = generation
  const made = source
    ? previewToBlob(source, look.filter, look.corners).then((blob) => {
        // Started over meanwhile: don't make a URL nothing would revoke.
        if (started !== generation) throw new Error('The document was cleared.')
        return assetStore.thumbUrl(blob)
      })
    : Promise.reject(new Error('Thumbnail is no longer available.'))
  // A failure shouldn't stick: drop it so the next render can retry.
  made.catch(() => cache.delete(key))
  cache.set(key, made)
  return made
}

type Thumbed = Pick<Asset, 'id' | 'thumbUrl' | 'format'>

/**
 * Previews for several pictures at once (a combined page, #76): one URL per
 * entry, the plain thumbnail until its filtered or cropped preview is ready.
 */
export const usePageThumbs = (
  pictures: readonly { asset: Thumbed; page: Partial<Look> & Pick<Page, 'filter'> }[],
): string[] => {
  const items = pictures.map(({ asset, page }) => {
    const look: Look = { filter: page.filter, corners: page.corners ?? null }
    const active = asset.format !== 'pdf' && (look.filter !== 'original' || look.corners !== null)
    return { asset, look, active, key: keyOf(asset, look) }
  })
  const keys = items.map((item) => (item.active ? item.key : '')).join('|')
  const [ready, setReady] = useState<Readonly<Record<string, string>>>({})

  useEffect(() => {
    let current = true
    for (const { asset, look, active, key } of items) {
      if (!active) continue
      previewOf(asset, look).then(
        (url) => {
          if (current) setReady((made) => (made[key] === url ? made : { ...made, [key]: url }))
        },
        () => {
          /* keep showing the plain thumbnail */
        },
      )
    }
    return () => {
      current = false
    }
    // `items` is captured by `keys`, which changes whenever a look does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys])

  return items.map(({ asset, active, key }) => (active ? ready[key] : undefined) ?? asset.thumbUrl)
}

export const usePageThumb = (asset: Thumbed, page: Partial<Look> & Pick<Page, 'filter'>): string =>
  usePageThumbs([{ asset, page }])[0] ?? asset.thumbUrl
