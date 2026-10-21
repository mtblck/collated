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

type Look = Pick<Page, 'filter' | 'corners'>

const keyOf = (asset: Pick<Asset, 'id'>, look: Look) =>
  `${asset.id}:${look.filter}:${JSON.stringify(look.corners)}`

const previewOf = (asset: Pick<Asset, 'id' | 'thumbUrl'>, look: Look) => {
  const key = keyOf(asset, look)
  const cached = cache.get(key)
  if (cached) return cached
  const source = assetStore.thumbBlob(asset.thumbUrl)
  const made = source
    ? previewToBlob(source, look.filter, look.corners).then((blob) => assetStore.thumbUrl(blob))
    : Promise.reject(new Error('Thumbnail is no longer available.'))
  // A failure shouldn't stick: drop it so the next render can retry.
  made.catch(() => cache.delete(key))
  cache.set(key, made)
  return made
}

export const usePageThumb = (
  asset: Pick<Asset, 'id' | 'thumbUrl' | 'format'>,
  page: Partial<Look> & Pick<Page, 'filter'>,
) => {
  const look: Look = { filter: page.filter, corners: page.corners ?? null }
  const active = asset.format !== 'pdf' && (look.filter !== 'original' || look.corners !== null)
  const key = keyOf(asset, look)
  const [ready, setReady] = useState<{ key: string; url: string } | null>(null)

  useEffect(() => {
    if (!active) return
    let current = true
    previewOf(asset, look).then(
      (url) => {
        if (current) setReady({ key, url })
      },
      () => {
        /* keep showing the plain thumbnail */
      },
    )
    return () => {
      current = false
    }
    // `look` is captured by `key`, which changes whenever it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, asset, key])

  return active && ready?.key === key ? ready.url : asset.thumbUrl
}
