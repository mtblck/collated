/** Two-digit page numbers ("01", "12"), as the portfolio numbers its sections. */
export const pageNumber = (index: number) => String(index + 1).padStart(2, '0')

/** When the saved copy was last written, in words: "today at 14:02", "on 21 Oct at 09:15". */
export const savedWhen = (savedAt: number, now = Date.now(), locale?: string) => {
  const at = new Date(savedAt)
  const time = at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date) => d.toDateString()
  if (day(at) === day(new Date(now))) return `today at ${time}`
  if (day(at) === day(new Date(now - 86_400_000))) return `yesterday at ${time}`
  return `on ${at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} at ${time}`
}
