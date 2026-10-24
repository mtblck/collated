import { useSyncExternalStore } from 'react'

/**
 * Whether the main pointer is a finger: phones and tablets, where Take photo
 * (#72) opens the camera. Laptops with a touch screen still report a fine
 * pointer, so they keep the plain file picker. Follows the media query live.
 */
const QUERY = '(pointer: coarse)'

const query = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null

const subscribe = (onChange: () => void) => {
  const list = query()
  list?.addEventListener('change', onChange)
  return () => list?.removeEventListener('change', onChange)
}

export const useTouchDevice = () =>
  useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? false,
    () => false,
  )
