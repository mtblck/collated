/**
 * The header row and wordmark every page shares: the landing view and the
 * workspace (Chrome.tsx), the docs and the task pages (docs-site.ts). One
 * place, so moving between them never shifts the name or the bar's height.
 * The workspace may be wider; the row's height and the name stay the same.
 */

/** The name, set in the UI's own face: semibold, tight, lower case. */
export const WORDMARK = 'text-xl leading-none font-semibold tracking-[-0.03em] text-ink lowercase'

/**
 * 64 px tall, the name centred in it. Contents up to 44 px (a touch-size
 * control) fit without growing it; the rule under the docs header is a
 * shadow, so it doesn't add a pixel either.
 */
export const HEADER_ROW = 'min-h-16 items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6'

/** The hairline under a header, drawn outside its box (see HEADER_ROW). */
export const HEADER_RULE = 'shadow-[0_1px_0_var(--c-rule)]'
