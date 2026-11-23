import { useSyncExternalStore } from 'react'

const list = (query: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null

/**
 * Whether a media query matches, following it live. False where there's no
 * matchMedia (jsdom, the server), so tests see the wide layout.
 */
export const useMediaQuery = (query: string) =>
  useSyncExternalStore(
    (onChange) => {
      const media = list(query)
      media?.addEventListener('change', onChange)
      return () => media?.removeEventListener('change', onChange)
    },
    () => list(query)?.matches ?? false,
    () => false,
  )

/**
 * Below Tailwind's `sm` (640 px): a phone, where the workspace's controls
 * sit in the dock along the bottom (DocumentBar) and the landing view has
 * its own (Chrome.tsx). The same query as Tailwind's `max-sm:`, exactly.
 */
export const PHONE = '(width < 40rem)'

/**
 * Below `lg` (1024 px): the inspector has no column of its own, so it opens
 * as a sheet over the pages (App). The same query as `max-lg:`.
 */
export const NARROW = '(width < 64rem)'
