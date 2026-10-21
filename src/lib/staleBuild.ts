/**
 * Code that loads on demand (the PDF reader, the HEIC decoder) is a hashed
 * file from the build this page came from. After a deploy, a tab opened
 * earlier asks for files that are gone, and each browser words the failure
 * differently. Recognise those so the message can say what to do.
 */
const PATTERNS = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite's own preload helper
]

export const isStaleBuild = (error: unknown) =>
  error instanceof Error && PATTERNS.some((pattern) => pattern.test(error.message))

export const STALE_BUILD_MESSAGE =
  'Collated was updated since this page was opened. Reload the page to use it (files you added will need adding again).'
