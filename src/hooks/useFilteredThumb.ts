import { useEffect, useState } from 'react'
import type { Asset, Filter } from '../core/model'
import { assetStore } from '../import/assetStore'
import { filterToBlob } from '../lib/filterCanvas'

/**
 * Filtered previews are made once per asset and filter, from the thumbnail,
 * with the same pixel code the export uses at full size — so what you see is
 * what the PDF gets. Cached for the session; released with the document.
 */
const cache = new Map<string, Promise<string>>()

const filteredThumb = (
  asset: Pick<Asset, 'id' | 'thumbUrl'>,
  filter: Exclude<Filter, 'original'>,
) => {
  const key = `${asset.id}:${filter}`
  let url = cache.get(key)
  if (!url) {
    const source = assetStore.thumbBlob(asset.thumbUrl)
    url = source
      ? filterToBlob(source, filter).then((blob) => assetStore.thumbUrl(blob))
      : Promise.reject(new Error('Thumbnail is no longer available.'))
    // A failure shouldn't stick: drop it so the next render can retry.
    url.catch(() => cache.delete(key))
    cache.set(key, url)
  }
  return url
}

/** The preview URL for a page: its thumbnail, or a filtered copy once ready. */
export const useFilteredThumb = (
  asset: Pick<Asset, 'id' | 'thumbUrl' | 'format'>,
  filter: Filter,
) => {
  const active = filter !== 'original' && asset.format !== 'pdf'
  const [ready, setReady] = useState<{ key: string; url: string } | null>(null)
  const key = `${asset.id}:${filter}`

  useEffect(() => {
    if (!active) return
    let current = true
    filteredThumb(asset, filter).then(
      (url) => {
        if (current) setReady({ key, url })
      },
      () => {
        /* keep showing the unfiltered thumbnail */
      },
    )
    return () => {
      current = false
    }
  }, [active, asset, filter, key])

  return active && ready?.key === key ? ready.url : asset.thumbUrl
}
