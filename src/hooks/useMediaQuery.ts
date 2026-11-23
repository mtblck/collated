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
 * its own (Chrome.tsx). Matches `max-sm:` in the class names.
 */
export const PHONE = '(max-width: 39.99rem)'

/**
 * Below `lg` (1024 px): the inspector has no column of its own, so it opens
 * as a sheet over the pages (App). Matches `max-lg:`.
 */
export const NARROW = '(max-width: 63.99rem)'
