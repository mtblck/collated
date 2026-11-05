/*
 * The scan camera's (#118) checks, apart from its component so the app can
 * ask whether to offer it without loading anything else.
 */

/** Whether this browser can open the camera here (a secure page, and the API). */
export const canScan = () =>
  typeof navigator !== 'undefined' &&
  'mediaDevices' in navigator &&
  typeof navigator.mediaDevices.getUserMedia === 'function' &&
  typeof window !== 'undefined' &&
  window.isSecureContext

/** What went wrong, in words for the person; Take photo is offered after it. */
export const cameraProblem = (error: unknown) => {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Collated wasn’t allowed to use the camera.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found on this device.'
  if (name === 'NotReadableError' || name === 'AbortError')
    return 'The camera is busy, maybe in another app.'
  return 'The camera couldn’t be started.'
}
