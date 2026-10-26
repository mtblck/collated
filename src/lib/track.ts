/**
 * "Used it" counts for mattblack.space/analytics (mtblck/boards docs/events.md).
 * Sends only the event's name: never a file, a title, a setting or anything
 * about the person. Same-origin: vercel.json rewrites /_mb/events to Boards, so
 * the CSP stays connect-src 'self'. Skipped off collatedpdf.com (localhost,
 * previews, tests), so only the live site counts. ADR 0016.
 */
export type UsedIt = 'exported'

export function track(event: UsedIt): void {
  if (location.hostname !== 'collatedpdf.com' || typeof navigator.sendBeacon !== 'function') return
  navigator.sendBeacon('/_mb/events', JSON.stringify({ project: 'collated', event }))
}
